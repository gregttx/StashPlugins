# GTTx Normalize Parent Tags

> ## 2.0.0 — the plugin is now called *GTTx Normalize Parent Tags*
>
> Only the display name changed. The folder, the plugin id and every setting keep their names, so
> an update carries your configuration over; what moves is where the plugin sits in Stash's
> alphabetical plugin list. The `GTTx ` prefix collects it with its siblings —
> `GTTx Merge Performer Tags To Scenes`,
> `GTTx Propagate Tags and Performers to Related Entities` and
> `GTTx Custom Fields Bulk Editor` — which are developed together and are
> meant to be updated together.

> ## ⚠ Back up your database before the first run
>
> These tasks rewrite tag assignments across your entire library, and **Stash has no undo**. A
> misconfigured Prune can strip a tagging scheme you spent years building, and the only way back
> is restoring your database file. Stop Stash, copy `stash-go.sqlite` (next to your `config.yml`)
> somewhere safe, start Stash again — then run the task. Review the dry-run log properly the
> first time; that is what it is for.
>
> The dialog does have an **[Undo](#undo)** button, but it only reaches its own writes and only
> while it stays open. It is a way out of a run you regret in the moment, not a safety net — the
> backup is the safety net.

> **Requires Stash 0.31.0 or newer.** Tag custom fields (two of the exclusion filters) and the
> `organized` flag on studios both depend on it.
>
> **This plugin has not had a long life in other people's libraries.** It has automated tests
> behind it, but that is not the same thing — which is another reason to take the backup above
> and to read the review log before pressing Proceed.

A front-end-only Stash plugin that adds three tasks to **Settings → Tasks → Plugin Tasks** — two
that change tag assignments, and one that only looks:

- **Prune Parent Tags from Entities...** — removes every tag on an entity that another tag on the
  *same* entity already implies.
- **Roll Up Parent Tags onto Entities...** — adds every parent tag, recursively, of the tags already
  on the entity.
- **Show Tag Hierarchy...** — a read-only browser of your tag tree. Writes nothing.

The first two open a dialog that lists every change *before* anything is written. Nothing is
saved until you press **Proceed**. The third never writes at all.

The colours on that page say which is which: the two writing tasks are **amber**, and
**Show Tag Hierarchy...** is **teal**, the plugin's colour for something that only reads. Two of the
settings below are amber for the same reason — see [Automatic mode](#automatic-mode).

Either direction can also be kept up **automatically**, applying to each entity as Stash saves it
rather than to the whole library at once — see [Automatic mode](#automatic-mode). That path has no
dialog and no undo, and it is off by default.

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

**Press Escape** to close the dialog, exactly as Cancel or Close would. While a write is actually in flight it does nothing - there is no Cancel to reach at that moment, and Stop is not something a stray keypress should do.

**Phase 1 — review.** The plugin scans every enabled entity type and shows you a running count
and a log of every change it *would* make:

```
[REMOVE] Scene "My Scene" (123) - Tag "Hair Colour" (45) - due to "Platinum" (47)
[REMOVE] Image "IMG_0042" (900) - Tag "Hair Colour" (45) - due to "Blonde" (46)
[ADD]    Performer "Jane" (7) - Tag "Hair Colour" (45) - due to "Platinum" (47)
[ERROR]  Scenes page 5 - findScenes failed: ...
[INFO]   2 tag(s) to remove: "Blonde" (46) x1, "Hair Colour" (45) x250
```

**The number in brackets after a name is that entity's or tag's Stash id** — `Scene "My Scene"
(123)` is the scene with id 123, and `Tag "Hair Colour" (45)` the tag with id 45. It is never a
count, and it is never part of the name: the id deliberately sits *outside* the quotes, so a scene
actually called `My Scene (2)` cannot be misread. The id is what you put after `/scenes/` or
`/tags/` in the address bar to open the thing the line is about, and it is what tells two tags with
the same name apart. Counts in the log are written differently — `x250` after a tag in the summary
line, `2 child(ren)` in the hierarchy viewer — so a bracketed number always means the same thing.
The dialog says this in a line under its warning, so you do not have to remember it.

The last line of each phase lists **every distinct tag the run touches**, with the number of
entities each one lands on. It is the quickest way to see whether a run is about to do what you
expect: the per-entity lines say what happens to one gallery, this says which tags are in play
across the whole library. Phase 2 prints its own version counting what was actually written, so
if a request failed the two lines will not match.

The tags are listed in the same order Stash itself sorts them — by **Sort Name** where a tag has
one, otherwise by name, ignoring case and treating numbers as numbers (`Volume 2` before
`Volume 10`) — so the line reads straight against your tag list without re-sorting it by eye.

**Hovering a tag in that line** shows what it is — its aliases and its description:

```
Hair Colour
Stash tag id 45
Aliases: Hair Color, Haircolour, and 2 more
Description: Every hair colour that occurs naturally, plus the dyed ones…
```

This is the line you approve a Prune from, so it is worth being sure the tags on it are the tags
you think they are. Only those with aliases or a description hover at all; the rest have nothing
to add beyond the name and id already shown. Long lists and long descriptions are
shortened — the aliases say how many more there are. It costs one extra query per recap, for the
handful of tags named there rather than for every tag in your hierarchy, and if it fails the line
simply reads as it always did.

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

**Rescan** starts the next pass with an empty view, so there is nothing to clear by hand. Once
changes have been written the log is the only record of what happened — **Copy log** it before you
rescan if you want to keep it.

## Undo

Once a run has written something, an **Undo** button appears. It reverses every change the dialog
has made — Prune puts the tags it removed back, Roll Up takes the tags it added off again — and it
covers the whole session, so a run you applied, rescanned and applied again comes back in one go.

The first click arms it and shows the scope (*"Undo 253 change(s)?"*); a second click within a few
seconds carries it out. Clicking anything else, or waiting, disarms it.

**Undo is not a database restore, and it is not a substitute for the backup.** Three limits, all of
them worth knowing before you rely on it:

- **It only lives as long as the dialog.** Close it, navigate away, or reload the page and the
  record is gone. There is no way to undo a run from a later session.
- **It only knows about its own writes.** It puts back exactly the tag assignments this dialog
  changed and touches nothing else. That is deliberate — it is written as an add/remove delta
  rather than by restoring an old tag list, so it cannot wipe out an unrelated edit you made in
  between.
- **It cannot see what happened in the meantime.** If you deliberately re-added a tag that Prune
  removed, Undo will not notice and will add it again (harmlessly). If something else added a tag
  that Roll Up also added, Undo removes it. Neither case loses anything Undo did not write, but the
  result is not always exactly where you started.

A failed request is never reversed, since nothing was written for it. **Stop** halts an undo after
the current request; whatever it has already put back stays put back, and the button comes straight
back for the rest.

## Browsing the tag hierarchy

A third task, **Show Tag Hierarchy...**, opens a read-only browser of your whole tag tree. It writes
nothing, so it is safe to open at any time — and it is the quickest way to understand what the
other two tasks would do before running either.

```
▾ Hair Colour (45)                                    2 child(ren)
  ▾ Blonde (12)                                       2 child(ren)
      Platinum (47)          ◆ 2 parents  leaf
      Ash (48)               ⛔ never removed: name filter   leaf
  ▸ Rare (6)                 ↩ shown under "Body" (4)
```

Each row reads **tag name followed by its Stash id in brackets** — `Hair Colour (45)` is the tag
with id 45, the same id the review log names it by and the one in `/tags/45`. The numbers that
*are* counts sit outside the brackets, in the badges on the right (`2 child(ren)`, `◆ 2 parents`),
and the inspector's headings spell them out the same way — `Parents: 3`, never `Parents (3)`.

**Hovering a tag name** shows what the row has no space for — the full name, the id, the tag's
aliases and its description:

```
Hair Colour
Stash tag id 45
Aliases: Hair Color, Haircolour, Hårfarge, and 4 more
Description: Every hair colour that occurs naturally, plus the dyed ones that pass for…
```

That is usually enough to settle "is this the tag I think it is" without leaving the viewer. Long
alias lists and long descriptions are shortened — the aliases say how many more there are, the
description ends in `…` — so a tag with forty aliases cannot bury the tree under a tooltip. The tag
page has the whole of both.

- **◆ n parents** — the tag hangs off more than one parent. These are worth knowing about: Prune
  treats *every* ancestor on *every* branch as implied. **Click the badge to go and see the next
  one**: it opens that branch and scrolls the tag into the middle of the view, so clicking it *n*
  times tours every parent and comes back to where you started. Hovering it lists them all.
- **↩ shown under X** — the same tag reached by a second path. It is drawn in full in one place
  only, so the tree stays readable. **Click the badge** to jump to that full copy.
- **⛔** — an exclusion filter you have configured protects this tag, and it names which one.
- **⚠ cycle** — a loop in the hierarchy. Both tasks refuse to touch tags in one; this is where you
  can find them.

Two boxes sit above the tree, and they do different things:

- **Find tag and jump to it** — takes you *to* a tag and leaves the tree intact. It opens the path
  down to the first tag whose name contains what you typed, selects it and scrolls it to the middle
  of the view, so you see it where it lives, with its parents and siblings around it. The counter
  beside the box shows `2 of 7`; press **Enter** to walk to the next match, wrapping at the end. If
  a filter was active, finding clears it — there is nowhere to show a tag in context inside a flat
  list. A **×** clears the box and the counter, leaving the tree where the find took you.
- **Filter by name** — reduces the tree *to* the matches, listed flat. Useful for "how many tags
  contain this" rather than "where is this one". A **×** appears in the box once you have typed
  something; clicking it clears the filter and puts the whole tree back.

Both boxes carry the **×** on the right-hand side, and it only appears once there is something to
clear.

Both match **any part of a tag's name and ignore case**, so `colour` finds `Hair Colour`. Neither is one of the exclusion filters — those stay case-sensitive, because they decide what
actually gets written.

Select any tag to see its parents, ancestors, children and descendants, plus a plain-language
answer for what Prune and Roll Up would do with it. Every tag named in those lists is clickable and
takes you to it — which is the direct way to reach one particular parent of a multi-parent tag,
where the **◆** badge walks them one at a time. **Load counts** adds how many scenes, images,
galleries and performers carry each tag — a separate query, so it is only made if you ask.

### Copy as DOT and Copy as Mermaid

The viewer draws a tree, not a graph — deliberately, because a real tag DAG is a hairball past a
few hundred nodes and drawing one needs a layout engine this plugin has nowhere to put. These two
buttons are the escape hatch for when you *do* want one drawn: they put a diagram of the hierarchy
on the clipboard for a tool built for it. Clicking one confirms in the button label for a couple of
seconds — **Copied whole hierarchy**, **Copied selection**, or **Copy failed** if the browser
blocked the clipboard.

**Selecting a tag scopes the export, and nothing else does.**

| State | What you get |
| --- | --- |
| Nothing selected | Every tag in your library, and every parent → child edge |
| A tag selected | That tag, **all its ancestors** and **all its descendants** |

**Filter by name** narrows the *tree*, not the export. **Find tag and jump to it** does scope it,
because jumping selects the tag it lands on. And there is **no way to deselect** — once you have
clicked any row, the viewer stays scoped to it for as long as it is open, so getting the whole
hierarchy back means closing the task and re-opening it without touching the tree.

An edge is only exported when **both** its ends are in the exported set, so a selection is cut
cleanly rather than left with arrows pointing at tags that are not there.

**Mermaid** pastes into [mermaid.live](https://mermaid.live), or straight into a GitHub comment or
a README inside a ` ```mermaid ` fence:

```
graph LR
  t12["Blonde (12)"]
  t45["Hair Colour (45)"]
  t47["Platinum (47)"]
  t45 --> t12
  t12 --> t47
```

Node ids are `t` followed by the Stash tag id — the letter is there because Mermaid will not accept
a bare number as an id — and the **label carries the id**, so a box in the picture leads back to
`/tags/45`. Arrows run parent → child. `graph LR` lays it out left to right; change `LR` to `TD`
for top-down if your tree is wider than it is deep.

**DOT** pastes into [GraphvizOnline](https://dreampuf.github.io/GraphvizOnline), or save it as
`tags.dot` and run `dot -Tsvg tags.dot -o tags.svg`:

```
digraph tags {
  rankdir=LR;
  node [shape=box];
  "12" [label="Blonde"];
  "45" [label="Hair Colour"];
  "47" [label="Platinum"];
  "45" -> "12";
  "12" -> "47";
}
```

Node ids are the raw Stash id, quoted. **The DOT label is the name only** — no id, unlike Mermaid.
`rankdir=LR` is the same left-to-right choice; drop the line for Graphviz's default top-down.

Use **Mermaid** for anything going into a document or an issue, and for a quick look — it renders
in place with no toolchain, and its labels carry the ids. Use **Graphviz** once the graph gets big:
its layout engine handles a few hundred nodes far better, and it renders to an SVG or PDF you can
zoom into. A whole-library export is usually a Graphviz job, but **exporting a selection instead**
is the better answer to most questions.

## Entity types

Every type is **off** until you enable it in **Settings → Plugins → GTTx Normalize Parent Tags**.
Stash has no default value for a plugin setting, and since Prune deletes tag assignments, opting
in per type is deliberate.

| Setting | Covers |
| --- | --- |
| **Include Performers** | Performers |
| **Include Studios** | Studios |
| **Include Groups** | Groups |
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

## Automatic mode

The two tasks normalize your library **once**. These two settings keep it that way:

| Setting | Does |
| --- | --- |
| **Auto Prune on Entity Updates** | Every time Stash saves an entity, remove any tag on it that another tag on the same entity already implies |
| **Auto Roll Up on Entity Updates** | Every time Stash saves an entity, add every ancestor of the tags on it |

> ### ⚠ There is no dialog and no undo out here
>
> The tasks show you a plan and wait for **Proceed**. Automatic mode does not: it writes the moment
> you press Save. **Auto Prune deletes tag assignments**, silently, one save at a time, and the
> only record is a line in your browser's developer console (F12). If it is misconfigured you will
> find out from your library, not from a log you can still read.
>
> Run the **Prune** task manually at least once, and read what it plans, before you turn this on.

**Their switches are amber on the settings page**, not Stash's blue. They are the only two
settings here that make the plugin write on its own — the rest just choose what a task covers —
so they are the two worth a second look before they are ticked.

Things worth knowing:

- **Both settings on does nothing at all.** They are exact opposites — one adds precisely what the
  other removes — so turning both on runs neither. The plugin says so on its own settings page, in
  a notice that stays up until you turn one of them off.
- **Which entity types are covered is the same "Include …" toggles** the tasks use, so a type you
  have not enabled is not touched here either. That also means you cannot auto-prune only scenes
  while the task covers everything; it is one list.
- **All the exclusion filters below still apply**, entity-level and tag-level alike.
- **Bulk edits count.** Editing 500 scenes from Stash's bulk edit dialog normalizes all 500. This
  is usually what you want and it is also the largest thing this mode does without asking.
- **The console lines read like the dialog's**, `[NormalizeParentTags] Scene "My Scene" (123) -
  Tag "Hair Colour" (45) - due to "Platinum" (47)`, so the bracketed numbers are Stash ids there
  too. The plugin says so once, before the first line it writes.
- **It only reacts in the tab it is running in**, like anything else that lives in the browser. A
  change made by the server, by a scan, or in another browser is picked up the next time that
  entity is saved in *this* tab — or by running the task.
- If another plugin fights it — something that puts a parent tag back as fast as Prune removes it —
  the plugin backs off that entity for a few seconds rather than trading writes with it forever.
  The other plugin's tag stays; run the Prune task if you want it gone.

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
   <stash-config-dir>/plugins/NormalizeParentTags/README.md
   ```
3. In Stash, go to **Settings → Plugins** and click **Reload plugins** (or restart Stash).
4. Refresh your browser (F5) so the plugin's JavaScript is loaded.
5. Enable the entity types you want in **Settings → Plugins → GTTx Normalize Parent Tags**.

### The README link in settings

**Settings → Plugins → GTTx Normalize Parent Tags** carries a link to this file, in two forms: the chain icon Stash puts in the header row, and a labelled
`NormalizeParentTags/README.md` link the plugin adds underneath the description — the icon alone is
easy to miss. Both open the same page.

### Checking which version is actually running

**Reload plugins cannot replace the script your browser is already running.** It re-reads the
plugin folder on the server; the JavaScript in your open page was fetched and executed when the
page loaded, and it stays until the page reloads. So an update always needs a page reload — but a
plain **F5** is normally enough: Stash serves plugin scripts so that a normal reload picks up a
changed file. Keep **Ctrl+Shift+R** (**Cmd+Shift+R**) for the case where it does not.

The version beside the plugin's name in **Settings → Plugins** does not settle this: it is read
from the manifest, which is current the instant you reload plugins, even when the script running in
the page is older. That combination — new version in the heading, old behaviour on screen — is
exactly what a cached script looks like.

The plugin therefore says which script is running, in your browser's console (**F12** → Console) on
every page load:

```
[npt] NormalizeParentTags.js 1.5.2 loaded. This is the running script own version - the settings
page reads the manifest instead, which can be newer than the script your browser has cached.
```

If that number is not the one you just installed, the page is running an old copy. In order:
reload (F5); check that the new `.js` really is in `<stash-config-dir>/plugins/` — a file that was
never copied cannot be refreshed into existence; then hard-refresh; then, if it still will not
budge, open DevTools → **Network**, tick **Disable cache**, and reload with DevTools open.

**The tasks check this for you.** Opening Prune or Roll Up asks Stash which version of the plugin
is installed and compares it with the script that is running. If they differ, the dialog says so at
the top and **Proceed stays disabled** until you reload the page — the plan would otherwise be
computed by the code you replaced. Nothing is blocked when the answer is simply unknown (an older
Stash, a failed request); only a definite mismatch holds a run back.

It cannot catch an edit made without changing the version — both numbers stay equal and there is
nothing to compare.

**Show Tag Hierarchy...** runs the same check but only says so — it writes nothing, so nothing is
blocked. The warning is worth reading anyway: the badges and the "what the tasks would do" answers
come from the rules in the script that is running, so a tab left open from before an update
describes the old ones.


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

- **Read carefully:** [⚠ Back up your database before the first run](#-back-up-your-database-before-the-first-run)
- Both tasks always cover your whole library. Filters and selections in the scene, image or
  performer lists are not read.
- Changes are written as add/remove deltas rather than as a wholesale rewrite of each entity's
  tag list, so a tag added from another browser tab between the review and the apply is not
  reverted. It may, however, mean the applied result differs slightly from the reviewed plan.
- If a request fails, the entities in it are reported as errors and are not counted as changed;
  the rest of the run continues.
- Cycles in a tag hierarchy are impossible to create through Stash's UI or API, which rejects
  them. If one is ever found anyway, the tags involved are reported as an error and skipped —
  under the plain rule, every tag in a cycle implies every other one, so all of them would
  otherwise be deleted.
- Installing this plugin does not undo anything you have already tagged. Out of the box it only
  ever acts when you click one of the two tasks and then press Proceed — automatic mode is off
  until you turn it on.
- Settings are read at the start of each run, so a change takes effect on the next run without a
  page reload. Automatic mode re-reads them at most every ten seconds, so a change there can take
  a few seconds to bite.
- Entities that need the same change are updated together in one request, so a run makes far
  fewer requests than it lists changes.

## If you also use the Merge Performer Tags To Scenes plugin

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

That cooperation now runs both ways. This plugin's [automatic mode](#automatic-mode) stands down
in turn while *that* plugin's library-wide task is writing, and it takes its own short-lived
notice while it writes, so auto-merge does not chase each automatic prune. If you run **Auto
Prune** and **Auto Merge On Scene Updates** together you are still asking for two opposite things
on every save — the tags a performer contributes will keep arriving, and Prune will keep removing
the redundant ones — but they will not trade writes back and forth over the same scene.

That plugin also has a library-wide task of its own, which rewrites scenes the same way this one
does. If it is mid-run when you start a task here, the dialog says so and names what it is doing.
It does not stop you — you pressed the button — but running both at once means each may undo part
of the other, so it is usually worth letting the first one finish.

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
