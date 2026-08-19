# CLAUDE.md — ᝯㄝₓ Normalize Parent Tags

Project-specific guidance for this plugin. The repo-wide conventions (ES5 IIFE, no build
step, `gqlRequest`, `tick()` + MutationObserver) are in `../CLAUDE.md` and still apply.

**Status: implemented at 4.5.0.** This file is both the design and the map of the code — the
sections below match the order of `NormalizeParentTags.js`. Where the code and this file
disagree, the code is what runs; fix the file.

**4.0.0 is one mode per entity type.** Seven `aNEnable<Type>` booleans and the two global
`a8AutoPruneOnUpdate` / `a9AutoRollUpOnUpdate` are one STRING setting, `a1AutoModes`, holding
`PERFORMERS=OFF, STUDIOS=OFF, ..., SCENES=PRUNE, ...`; the two writing tasks are one
**Normalize Parent Tags...**, whose dialog carries the seven selectors; and a new
**Auto Mode Settings...** task is the editor for the string. The user asked for exactly this, in
this shape, and the reasoning worth keeping is in §6a, §5c and §2. Six things about the change
itself:

- **Nine booleans could not say it.** The old pair of auto flags had four combinations for three
  meanings, and the fourth (both on) had to be documented as a no-op, warned about on the settings
  page, checked in the API, and re-explained in two sibling plugins. Every one of those went with
  it: a type carries one of three values and the incoherent state is unrepresentable.
- **A Stash plugin setting is BOOLEAN, NUMBER or STRING.** There is no tri-state, no enum and no
  repeated group, so seven tri-states are either fourteen checkboxes with an illegal pair in each,
  or one string. The string won, and the dialog is what saves anyone from typing it.
- **Parsing forgives, formatting does not.** `parseAutoModes` picks `<type>=<mode>` out of anything,
  in any order, any case, singular accepted, unknown words ignored, last mention winning; a missing
  type is OFF. `formatAutoModes` writes the same seven pairs every time. `normalizeSettingField`
  writes the canonical form back once Stash has saved a hand edit — never while the field has
  focus, and never twice for the same text, which is what stops it from fighting the typist or
  looping against a Stash that does not re-render the value.
- **The migration is the whole reason a rename is affordable.** §6's rule still holds - a key is a
  storage key and renaming one strands the value - so `settingsFrom` reads the old keys when the
  new one is empty, maps them (an enabled type takes whichever single auto mode was on; both on
  migrates to OFF, since that was the no-op) and writes the result back once per page. Everything a
  user had is carried over, and this is the only kind of rename that should ever be done this way.
- **The API needed no new field.** `apiPrepare`'s `autoMode` was published at 3.2.0 as *a question,
  not a setting*, in as many words, against exactly this hypothetical. `TagBundleClipboard` did not
  change a line. The two hardcoded sibling checks did change, because they read the settings by
  name - which is the trade that note describes, and it went the way it said it would.
- **One task, because the mode is no longer a property of the run.** Prune and Roll Up as two task
  names only made sense while a run had one direction. With a mode per type, "which button did you
  press" would have set a default the selectors immediately override.

**3.1.0 is the busy cursor.** `▙ ▛ ▜ ▟` under the last log line, one cycle at 2Hz, for as long as
the run dialog is scanning, applying or undoing. The counters were the only signal a pass was alive,
and a per-type figure that has not moved for several seconds over a large page reads as a hung tab.
`spin(busy)` hangs off `setState` and nothing else — every path in and out of a write goes through
there — and `flush()` lifts the cursor out before appending and puts it back at the end, so a log
line can never land under it. It is `.npt-spin`, never `.npt-line`: the render cap counts children,
and `dialog().lines` reads that class. The interval is also cleared in `close()`, for a dialog
dismissed mid-write. The repo-root CLAUDE.md carries the shared design; all four plugins took it in
one release.

**3.0.0 is the second rename, and the same kind of change as 2.0.0.** The `GTTx ` prefix is now
`ᝯㄝₓ `, in the `.yml`, the `manifest`, `PLUGIN_NAME`, `PLUGIN_SHORT_NAME`, `SIBLING_NAME` and every
fixture in `tests/` that mounts a settings or tasks heading. The folder, the plugin **id**, every
setting key and every storage slot are untouched, so an upgrade keeps its configuration; the major
digit is for the heading matches in §2 and §5b now comparing against a different string.

**What the rename taught, and the reason it is worth a note here rather than only in the repo
root: the four plugins fail differently when the `.yml` moves without the `.js`.** The user renamed
the manifests first, and this plugin's settings page looked untouched — because `ownSettingGroup`
enters through the `plugin-<id>-<key>` ids Stash builds from the plugin **id**, and `headingIsOurs`
is only its fallback. `CustomFieldsBulkEditor` has no setting-id route at all and decorated
nothing, silently. The half that *was* broken here and invisible: `ownTaskName` compares the group
heading against `PLUGIN_NAME` with no id fallback, so both task buttons stopped being ours — no
interception, no amber. **A name lives in two files and they are not interchangeable; a settings
page that still looks right is not evidence the rename landed.**

**2.6.1 takes the release notes out of the README.** The standing rule is new and lives in the
repo-root CLAUDE.md ("A README describes the plugin, not its history"): a block at the top of a
README is for a **major** version only - a rename, a settings reset, something a user already
running the plugin has to act on - and everything else belongs in the prose that describes the
behaviour, in the present tense. The 2.4.0 and 2.0.0 blocks are gone; the inspector's link was already described under *Browsing the tag hierarchy*, and the stale-script banner now reads as part of *Checking which version is actually running*, beside the console line and the task's own gate. Nothing was lost: each removed note had a section that
already covered its area, which is the test of whether the note was needed at all. The per-version
reasoning stays here, in a file that does not ship.

**2.6.0 puts the same warning in the dialogs.** The version check was always there and always
blocked Proceed; what changed is that its message is a box of its own (`.npt-stale`, the settings
banner's red) under the dialog title, rather than a sentence appended to `noteEl` behind whatever
else the run had to say. Three things about it:

- **`showStale(msg)` rather than `note(msg)`**, and the message goes to the log by hand beside it.
  `note` does both, which is right for a warning about the *library* - the log is where a user reads
  those back. This one is about the dialog itself running code the user has already replaced, and it
  is the only warning here that blocks, so it gets its own place in the head and keeps the log line
  Copy log needs.
- **`begin()` clears it**, like the note beside it: a rescan after the reload the box asked for must
  not go on claiming the script is stale.
- **The harness's `dialog().note` now concatenates both boxes**, and `dialog().stale` reads the new
  one alone. Every existing check asking "does the head say so" keeps working and keeps meaning what
  it meant; the checks that are about *which* box a message is in name it.

**The hierarchy viewer's copy moved too**, from `.npt-warn` to `.npt-stale`. It still blocks nothing - it writes nothing to block - but a stale script should look the same wherever the user meets it.

**2.5.0 tells the user the script is stale, where they can see it.** Stash serves plugin JS with
caching on, so a browser can go on running the old file after an update with nothing on screen
saying so - and the settings heading is the one place the two numbers meet, since Stash builds it
as `${name} (${version})` from the **manifest**, read fresh from the server, while
`PLUGIN_VERSION` is what the browser actually loaded. `ensureStaleNotice` compares them on the
settings tick and puts a red banner in this plugin's own group when they disagree, naming both
numbers and **Ctrl+Shift+R**.

Four things it depends on, all four duplicated byte-identically across the four plugins like every
other shared mechanism here:

- **No query.** The number is already on the page, and this tick runs once a second.
  `installedVersion` asks the server the same question, which is right for a dialog that opens once
  and wrong for a timer - and `CustomFieldsBulkEditor`'s settings page is pinned by a test as
  issuing no queries at all.
- **The heading is read from the group already found**, never searched for across the page: the
  header row precedes the setting rows, which have h3s of their own, and a page carrying several
  plugins' groups would otherwise offer a stranger's version number.
- **Unknown is not a mismatch.** Settings → Tasks heads its group with the bare name and no
  version at all, so no parenthesised number means silence rather than a guess.
- **Above the description, inside the group header** - which is outside Stash's `<Collapse>`, so a
  collapsed group still shows it, and the README link's slot is untouched.

It catches only what a version bump makes visible; editing a file without bumping it leaves both
numbers equal and this check blind, which is the practical argument for the repo's patch-digit rule.

**2.4.0 links the inspector's title to the tag.** The viewer named the selected tag and gave no way
to open it; the title is an `<a>` to `/tags/<id>` with `target="_blank"`, and it says so on hover.
The new tab is the point rather than a detail: this dialog holds a scan of the whole hierarchy, and
navigating in this tab throws it away to show one tag. An anchor rather than a click handler, so
middle-click and ctrl-click behave the way they do everywhere else, and `.npt-i-title` gained
`display:block` (an inline box drops the margin under it) with the colour inherited, so it still
reads as a heading rather than as a link.

**2.3.0 keeps the log until the dialog closes, and gives Rescan a tooltip.** `rescan()` no longer
empties the rendered log — it writes `--- Rescan ---` and the next pass carries on below it, which is
what `CustomFieldsBulkEditor` has always done and what the user asked the other three to match. The
consequence is a **deletion**: `viewLines` existed only because a rescan emptied the view under the
counter, so with the view session-scoped it is exactly `lines.length` and is gone (§5's "two
counters, deliberately" is now one). All three siblings changed together, along with the shared
footer order — `CustomFieldsBulkEditor` moved Apply to the leading position this dialog gives
Proceed.

**2.2.2 says "id", not "Stash id", and never "(s)".** Two repo-wide wording rules landed together, and
both are in the root `CLAUDE.md`. *Stash ID* is already Stash's own name for a **stash-box**
identifier, so calling the local database id one was a claim about a metadata provider that had
never been consulted - every dialog head, legend and README here now says **id**. And every
generated `3 scene(s)` / `2 child(ren)` now agrees with its own count, through one
`plural(n, one, many)` helper held byte-identical in all four plugins beside `coopObject`.

**2.2.1 trims one word from the head.** "only while it stays open" is now "while it stays open" - the load-bearing "only" is the one in "reverses only what this dialog wrote", and a second in the same clause read as emphasis rather than a limit. All three dialogs were reworded together at the user's wording; `CustomFieldsBulkEditor` 0.4.1 carries the same sentence.

**2.2.0 is the viewer's footer.** The two graph exports are gone (§5a), `Load counts` gained a tooltip and now says `Refresh counts` once it has loaded them. All three were live feedback on 2.1.0; the exports are the only capability ever removed from this plugin, and §5a records why so it is not re-added on the same reasoning that put it there.

**2.1.0 adds Escape to the dialogs.** Every dialog here now closes on Escape, through whichever of Cancel/Close its footer is showing rather than around the footer - so the key does nothing mid-write, where both are hidden and Stop is the only way out. The head's backup line was reworded to "Backing up your database before proceeding is recommended." at the same version, in all four plugins; the sentence stating what Undo cannot reach is unchanged. Both dialogs, the run and the hierarchy viewer.

**2.0.1 is a README line.** A fourth plugin, `GTTx Custom Fields Bulk Editor`, joined the repo, so the upgrade banner's "its two siblings" had become wrong. The README ships in `files:`, which is why a prose fix took a patch digit; nothing in the script changed but the constant.

**2.0.0 is a rename, not a rewrite.** The plugin is now `GTTx Normalize Parent Tags` everywhere
its display name appears — `.yml`, `manifest`, `PLUGIN_NAME` — so the three plugins in this repo
group together in Stash's plugin list and are recognisable as one author's. The major digit says
so because the name is what the user searches the settings page for, and because every heading
match in §2 and §5b now compares against a different string. Nothing else changed: the folder,
the plugin **id**, every setting key and every storage slot are untouched, so an upgrade keeps its
configuration. `PLUGIN_SHORT_NAME` arrived with it — the same string here, since this name already
fits in a dialog title — so that every plugin's dialog head reads from one expression. See
"Cross-plugin cooperation: one name prefix" in the repo-root `CLAUDE.md`.

Two things in here are deliberately *not* implemented, and should stay that way until there is
a reason: the candidate-narrowing tag filter in §5 (plain paging is correct and simpler, and the
per-page payload is only ids and tag ids), and any attempt to reconcile a plan with changes made
during phase 2 (Rescan is the answer, see §5).

---

## 1. What the plugin does

Stash tag hierarchies are implied downward: if `Blonde` has parent `Hair Colour`, an entity
tagged `Blonde` is already understood to be `Hair Colour`. Storing both on the same entity is
redundant. Two library-wide tasks make that explicit, in either direction:

- **Prune** — remove every tag on an entity that is a strict ancestor of another tag on the *same*
  entity. What survives is the antichain of the entity's tag set: every tag with no descendant of
  its own present. That includes leaf tags and any intermediate tag whose children (direct or
  indirect) are all absent.
- **Roll Up** — add every strict ancestor, recursively, of every tag on the entity.

**Which of the two, or neither, is a property of the entity type rather than of the run** (4.0.0).
One library-wide task, **Normalize Parent Tags...**, plans each type in the direction its selector
says; the same seven selectors, saved as the `a1AutoModes` setting, are what runs automatically on
every save. §6a is the setting, §5c the selectors.

The remaining task names are deliberately long: the name is both the `SettingGroup` heading and
the button label, and a short form ("Prune Parent Tags") reads as though it edits the tag
hierarchy.

Either direction can also run **automatically**, on every entity Stash saves, rather than as a
library-wide pass — see §5b. Same planning code, no dialog.

**This plugin can destroy a tagging scheme in one click.** Prune deletes tag assignments library-
wide, Stash has no undo, and the only recovery from a run you have walked away from is a database
restore. Every surface — manifest description, task descriptions, README, and the dry-run dialog
itself — must tell the user to back up their database before the first run. Do not let that get
edited out for brevity, and in particular do not let the Undo button in §5 be presented as making
the backup unnecessary: it reaches its own writes, and only while the dialog is open.

**Auto mode can destroy one without any click at all**, which is why §5b is written the way it is:
it has no dialog, no review, no tag summary and no Undo, and a console line is the only record it
leaves. Every type is OFF by default, and the setting's description carries the warning in place of
the dialog that is not there — **in its tooltip half since 1.7.5**, at the user's explicit request,
so the warning is one hover away rather than on the page. The dialog behind **Auto Mode
Settings...** carries the same sentence in its head, where it replaces the backup instruction the
writing dialogs lead with: that dialog writes a setting, not the library, and telling its user to
back up first would be answering a question they did not ask. The wording itself is not to be
trimmed on either surface.

The two are inverses in the useful sense: rolling a type up and then pruning it returns the
original antichain (minus whatever the exclusion filters protected). That is also the reason a type
carries one of them and not both.

Neither task ever touches the tag hierarchy itself — only the tag *assignments* on entities.

## 2. Entry point: Settings → Tasks → Plugin Tasks

The user asked for these to live in the **Plugin Tasks** section of the Tasks page. There is no
patchable component for that page (see the list in Stash's `UIPluginApi.md` — `Setting` and
`SettingGroup` are patchable but far too generic, and there is no `SettingsTasksPanel` or
`PluginTasks`), so the placement is achieved a different way:

**Declare the tasks in `NormalizeParentTags.yml` under `tasks:` and let Stash render them.**
`PluginTasks.tsx` lists every enabled plugin with `tasks.length > 0`, so declaring tasks is
enough to get a native, correctly-styled collapsible group named after the plugin, with one
button per task. No DOM construction, no CSS guessing, no breakage when Stash restyles the page.

**All three task names end in "..." since 1.9.0**, because all three open a dialog rather than
acting — the repo-wide convention, and `Show Tag Hierarchy...` earns it as much as the two that
write. The name is the button's label, so it lives in **two** places that must agree: `tasks:` in
the manifest, and `TASKS` in the JS, which is what `ownTaskName` matches a click against. Change
one without the other and the click stops being caught, which means it reaches Stash's job queue
and fails there.

The catch: this plugin has no `exec`/`interface`, so the task cannot actually run server-side.
Stash's loader does not mind (`Config.valid()` only checks `interface` and setting types, and
`tasks` without `exec` loads fine), but a click would reach `mutateRunPluginTask` and fail in the
job queue. So the click is caught client-side, with two independent layers:

1. **Primary — capture-phase click listener on `document`.** React 17+ attaches its handlers to
   the root container, which is a descendant of `document`, so a capture listener on `document`
   fires first and `stopPropagation()` prevents `onPluginTaskClicked` from ever running. This
   also suppresses the misleading "Added job to queue" toast. Identify the button by walking up
   to the enclosing `.setting`, and matching the button's text against our two declared task
   names *within* the plugin's own `SettingGroup` (match the group heading against the plugin
   name) — never by task name alone, or another plugin with a same-named task gets hijacked.
   **Answer from the button's own `.setting-group` and stop there** (1.8.0). Until then the walk
   tested *every* ancestor for an `h3`, so on a miss it climbed past the group into the panel that
   holds all of them, where `querySelector('h3')` returns whichever plugin is listed first — which
   hijacked exactly the same-named task the heading check exists to protect, whenever we were
   listed above it. Note that a group's *first* `h3` is its heading and each task row carries an
   `h3` of its own, so the walk cannot simply stop at the nearest ancestor holding any `h3`. The
   old any-ancestor walk survives as a fallback for a Stash that does not put `setting-group` on
   that box, bug and all: it is what every earlier release shipped, so it cannot be worse. All
   three plugins carried this and all three were fixed together; `tests/placement.test.js` found
   it, and covers it against `MergePerformerTagsToScenes`.
   `TASKS` is the list; adding a task means adding it there as well as to the manifest.
2. **Fallback — `window.fetch` wrapper.** If layer 1 misses (Stash restructures the page, the
   button is reached by keyboard in a way we did not anticipate), catch the `runPluginTask`
   mutation whose `plugin_id` is ours, return a synthesized successful response so the mutation
   never reaches the server, and open the dialog. The sibling plugin already wraps `fetch`, so
   the pattern is established here.

If both layers ever fail, the outcome is a failed job in Stash's log and no data change — the
safe direction.

Rejected alternative: building our own section in the Tasks page by DOM injection. It is honest
about not being a server task, but it means hand-rolling Stash's `SettingSection`/`Setting`
markup and keeping it looking right across releases, for no functional gain.

## 3. Algorithm

### Hierarchy

One query fetches the whole DAG:

```graphql
findTags(filter: { per_page: -1 }) {
  tags { id name ignore_auto_tag parents { id } custom_fields }
}
```

`custom_fields` is only requested when one of the two custom-field settings is non-empty (same
rule as the sibling plugin). From this build:

- `parentsOf[id] -> [id]`
- `ancestorsOf[id] -> Set<id>` — memoized transitive closure, computed on demand with a
  recursion stack so a cycle cannot hang the walk (see §7 on cycles).

### Prune

For an entity with tag set `T`:

```
implied = union over t in T of ancestorsOf(t)      // strict ancestors only
remove  = { t in T : t in implied and removable(t) }
keep    = T \ remove
```

`implied` is computed against the **original** `T`, never against a set that is being mutated as
the loop runs. See §7 for why that matters.

### Roll Up

```
add = (union over t in T of ancestorsOf(t)) \ T, filtered by addable(t)
```

A tag rejected by `addable()` is skipped *individually* — its own parents are still added. The
filters describe a tag, not a barrier in the hierarchy. Document this; the other reading
(treat an excluded tag as a wall and stop climbing) is defensible but surprising.

### The reason ("due to")

`implied` is not a set but a map from each implied tag to the tag on the entity that implies it,
and that tag is logged as the change's reason. Where several present tags imply the same
ancestor, the **lowest** wins: a candidate that is an ancestor of another candidate is higher up
the hierarchy and loses. Candidates that are incomparable — a diamond, or two unrelated children
of one parent — are a genuine tie, broken on the **lowest tag id**, compared numerically where
both ids parse so 9 sorts below 10. The tie-break exists for determinism, not for meaning:
`for…in` order is not guaranteed, and a log that shuffles between two runs over an unchanged
library cannot be used to audit anything.

Two properties worth keeping true:

- **In Prune the reason tag is never itself removed in the same run.** If it were, whatever
  implied *it* would be a strictly lower candidate for the same ancestor and would have won the
  contest. So a `[REMOVE]` line always points at a tag that survives — which is the whole reason
  the clause is useful.
- **A marker's primary tag can be a reason**, since it counts as present. That is correct and
  informative: it explains a removal that is otherwise unexplainable from the marker's tag list
  alone.

### Markers

`SceneMarker` has `primary_tag: Tag!` (required, separate field) and `tags: [Tag!]!`.

- The primary tag **counts as present**: it goes into `T` for computing `implied`, so a marker
  with primary tag `Blonde` and tag `Hair Colour` prunes `Hair Colour`.
- The primary tag is **never a candidate for removal**: it is not in `tags`, the schema will not
  let it be blank, and dropping it would destroy the marker's meaning.
- Roll Up adds ancestors to `tags`, never to `primary_tag`.
- A tag that duplicates the primary tag inside `tags` is left alone. Removing it is arguably
  right but it is not a parent/child relationship, so it is out of scope.

## 4. Exclusion filters

Entity-level (skip the whole entity, both tasks):

| Setting | Applies to |
| --- | --- |
| `b1ExcludeEntityWithTagName` | All types. Resolve the name to an ID once per run (exact, case-sensitive, client-side re-check — Stash's `EQUALS` compiles to SQL `LIKE`, where `_` and `%` are wildcards). Direct presence only; for markers, the primary tag counts. A failed lookup **aborts the run** rather than running unfiltered. |
| `b2ExcludeOrganized` | Scenes, images, galleries, studios — the only types with an `organized` field in Stash 0.31. Do **not** hard-code that list into the queries: request `organized` per type from a table, and if a future Stash adds the flag elsewhere, only the table changes. Performers, groups and markers have no flag, so the setting silently cannot protect them — say so in the setting's description. |

Tag-level (skip the individual tag):

| Setting | Blocks |
| --- | --- |
| `c1ExcludeTagWithIgnoreAutoTag` | add + remove |
| `c2ExcludeAddTagNameContains` | add |
| `c3ExcludeRemoveTagNameContains` | remove |
| `c4TagNameSeparator` | neither on its own — it splits `c2`/`c3` |
| `c5ExcludeAddTagWithCustomFieldName` | add |
| `c6ExcludeRemoveTagWithCustomFieldName` | remove |

Custom-field matching is presence-only via `hasOwnProperty` (never `in` — inherited keys like
`constructor` would match every tag), values never inspected, exactly as the sibling plugin does.
Name matching is a case-sensitive substring (`indexOf !== -1`) over the raw Unicode string: these
are meant for namespace markers, and case-insensitivity would drag in locale surprises for no
benefit. Aliases are not matched, only the name.

Since 0.5.0 the two name settings hold **several substrings separated by whitespace**, and a tag is
excluded when its name contains **any** of them (`splitTerms` + `nameMatchesAny`). Empty tokens are
dropped, so padding and repeated separators are harmless — and a blank setting must yield an empty
list, never a term matching every name. Note the upgrade consequence — a pre-0.5.0 value of
`Hair Colour` was one substring and is now two, matching strictly more tags. That direction is the
safe one (more tags protected from Prune, fewer added by Roll Up), but it is a silent change in
meaning for anyone who had a phrase in there.

`c4TagNameSeparator` (0.6.0) buys back the substring-with-a-space that whitespace splitting costs:
set it and the two lists split on that string instead. Three things it must keep doing:

- **Split on a string, never a `RegExp`.** `.` and `|` are plausible separators, and `new RegExp('|')`
  is an empty alternation that splits every character — single letters that would protect most of a
  library. Users should not have to escape punctuation.
- **Trim each term**, so `a, b` does not carry a leading space into the match, and drop the empties,
  so a setting of nothing but separators leaves an empty list.
- **Trim the separator itself**, and treat an empty one as "use whitespace" — which is also the only
  way to ask for a plain space.

Testing the separator needs care: splitting a phrase always leaves pieces that still match the tag
the phrase matched, so the two behaviours only differ against a *second* tag one of those pieces
reaches. The suite uses `Body Art` and `Art Deco` for exactly that, and the first version of the
test passed against the unfixed build until it did.

A protected tag never breaks correctness: a parent kept back by a filter is still implied by its
descendant, and the descendant's own status is unaffected.

## 5. Scale and the dialog's three phases

### Fetching entities

`per_page: -1` means "no paging, return every match in one response" — it is what the sibling
plugin uses for tag lookups. It is right for the tag list (thousands of rows at most) and wrong
for scenes and images (a large library has hundreds of thousands, and one response holding all
of them is a browser tab that stops responding). So:

- Tags: one `per_page: -1` query.
- Entities: **page**, `per_page: 1000` (500 for images), ascending by `id`, sequentially, so the
  dialog can count progress and the browser stays responsive.
- Narrowing, **deferred, not implemented**: only entities carrying a tag that *can* matter need fetching.
  For Prune that is the set of tags with at least one child; for Roll Up, tags with at least one
  parent. Pass those as `tags: { value: [...], modifier: INCLUDES, depth: 0 }` in the type's
  filter. `SceneMarkerFilterType` has a `tags` field too. If the ID list is enormous, or the
  filtered query errors, fall back to paging everything — the filter is an optimization, never
  a correctness requirement.

Request only what is needed: `id`, `tags { id }`, `organized` where it exists, and a display name.
`name` for performers, studios and groups; `title` everywhere else, but `title` is **optional** on
scenes, galleries and images, so each needs its own fallback:

| Type | Fallback after `title` |
| --- | --- |
| Scenes | `files { basename }` |
| Galleries | `files { basename }`, then `folder { basename }` — a gallery is a zip (`.cbz` is one) *or* a folder, and a folder gallery has no file at all |
| Images | `visual_files { ... on ImageFile { basename } ... on VideoFile { basename } }` — `Image.files` is deprecated in favour of `visual_files`, which is a **union**, so the concrete types have to be named |
| Markers | `primary_tag { id name }` |

`entityLabel` reads whichever of `files` / `visual_files` / `folder` is present rather than
switching on `type.key`: the type's `fields` decides what exists, and a per-type branch in the
labeller is what let galleries and images log as `"untitled"` from 0.1.0 until 0.3.1 — the
fallback was written for scenes and never extended, and the two types did not even request the
fields it would have needed.

### Processing order

Types are scanned and applied in a fixed order, never in the order the settings happen to be
listed:

```
Performers → Studios → Groups → Galleries → Scenes → Images → Markers
```

Performers lead for the reason in §8: `MergePerformerTagsToScenes` reacts to a `bulkPerformerUpdate`
by merging performer tags into all of that performer's scenes, so anything it stirs up should be
stirred up before the scene and image passes run, not after. Markers trail their scenes for the
same reason in reverse — a marker is a child of a scene, and finishing with them means the scene
pass has already settled. The order is a constant in one place; do not derive it from the
settings object's key order, which is not guaranteed and would silently change meaning.

### 5c. The seven selectors (4.0.0)

The run dialog's head carries a `modesPanel` — one `<select>` per type, Off / Prune / Roll Up — and
a **keep this selection** checkbox. Five decisions in it are worth not re-litigating:

- **The panel mutates the run's own `this.modes`.** There is no second copy to keep in step; the
  scan filters `TYPES` on it and passes each type's own mode to `scanType`.
- **Seeded once, in `begin()`, guarded by `modesReady`.** A Rescan re-enters `begin()`, and
  re-seeding there would throw away the selection the user just made and then pressed Rescan to act
  on. That guard lives on the object rather than in `reset()` for exactly that reason.
- **Images start Off however they are configured.** The user asked for this specifically, and the
  reason is in the setting's own description since 1.0.0: images are usually the largest type and
  the slowest to scan. A whole-library image pass is a decision per run; the automatic mode is
  about one image at a time. **The run dialog's selector says so too** (4.2.0): a `note` on a type
  in `TYPES` puts a grey `(slow)` beside its name and the sentence in the title of both the label
  and the select. A tooltip alone would have been a warning nobody knows to hover for, and the
  setting description that carried this since 1.0.0 is on a different page from the dialog that
  acts on it. It is a field on the type rather than a test for `images`, so a second slow type
  costs a string. **The settings dialog passes `quiet` and shows neither** (4.2.2): the warning is
  about a whole-library pass, and that dialog starts none - it configures what happens as a single
  entity is saved. Which is also why the note no longer ends by saying the automatic mode is
  unaffected: the only dialog that still carries it is the one that is not about the automatic
  mode.
- **Changing a selector after a plan exists disables Proceed and reveals Rescan.** The plan on
  screen was computed for the previous selection, so pressing Proceed would write something other
  than what the dialog now says it covers - the one way this UI could lie. `selectionDirty` is
  cleared by `reset()`, which a Rescan goes through.
- **The kept selection is `localStorage`, not a setting.** It is one browser's convenience rather
  than something every tab and every user of that Stash shares, and a second persisted answer
  beside the auto modes is exactly the confusion 4.0.0 removed. It is re-parsed through
  `parseAutoModes(formatAutoModes(...))` on the way out, so a hand-edited or truncated value can
  only ever read as OFF.

**The selects line up and the labels are right-aligned against them** (4.2.1). Three tries: the
rows were `justify-content:space-between`, which lined all seven selects up in a straight column but
left each label at the far left of its own row, so a select read as belonging to the *type on its
right*; 4.1.1 answered with a `min-width` on the label, which pulled the pair together and gave up
the aligned column. `flex:1;text-align:right` on the label is both — the select stays at the end of
the column and the label's text ends right beside it. **A label separated from its control was the
alignment being paid for in the wrong currency; right-aligning the text is what the column cost
was actually for.**

**The preview line says what it is, and marks what will be written** (4.3.0). It was a bare
`PERFORMERS=OFF, STUDIOS=OFF, ...` under the selectors, which is a value with nothing saying it is
one; it now opens with an amber `Automatic mode per entity type Setting String:` and draws each
pair as its own span, amber wherever the mode is not OFF. `render()` builds spans rather than
setting `textContent`, so `formatAutoModes` stays the single definition of the string's *shape* and
is still what `save()` writes - the dialog renders the same pairs, it does not format a second
version of them. The amber is the one the selectors already use for a mode that writes, which is
what makes the line readable as a summary of the row of selects above it rather than as a
restatement.

**The settings row is taken over by the dialog that edits it** (4.4.0, and right at 4.5.0).
`modeFieldTick` replaces the two halves Stash renders for a STRING setting — the raw value and the
**Edit** button that opens Stash's own text modal — with `renderModeString` and an **Auto Mode
Settings...** button, and leaves the heading and description exactly as they are.

**There is no text input on that page, and 4.4.0 shipped believing there was.** Read off
`Inputs.tsx` on `develop` (2026-08-18) after a live screenshot showed the whole row gone: a BOOLEAN
setting goes through `BooleanSetting`, which puts the `plugin-<id>-<key>` id on the `Form.Switch`,
but a STRING or NUMBER goes through `ModalSetting` → `ChangeButtonSetting`, which puts it on the
**row div** — with the value in a `.value` div and an Edit button beside it. Everything here that
walks *up* from `settingElement` was right either way, which is why nothing noticed for four
releases; 4.4.0 set `display:none` on it and hid the heading, the description and the row with it.

**The renormalizer had been dead the whole time, for the same reason.** It guarded on
`typeof input.value !== 'string'`, which a `<div>` never satisfies, so neither the canonical rewrite
nor the armed bar it also applied had ever run on a live page — and its suite passed throughout,
because the fixture was built from the same wrong assumption. **A test fixture written from a guess
about someone else's markup will confirm the guess.** The fixture now mirrors
`ChangeButtonSetting`, and the rewrite reads the settings rather than a field: nobody can type into
this setting from our side any more, Stash's modal is still reachable if our button never builds,
and a config file can hold anything.

**Three decisions in `modeFieldTick`**, all in the code's own comment: Stash's two halves are
hidden from JS and only once ours are in place (a stylesheet rule would be shorter and would hide
Stash's editor on a page where ours never built, leaving the setting with no editor at all); the
line is drawn from the settings cache rather than from `.value`, because our dialog saves straight
through `fetch` and Stash's React state never hears about that write; and the button is teal like
its twin in Settings → Tasks, since what it edits is a setting and what that setting says is already
in amber on the line above it.

**The value reads in words, not tokens** (4.5.0): `Performers=Off, Scenes=Prune, Scene
Markers=Roll Up`, from one `MODE_LABEL` table the selectors also draw their options from. The
stored string stays what `formatAutoModes` writes, and `MODE_PAIR` accepts either shape — any case,
`roll up`, the singular of a type — so what is shown would still be understood if it were typed
back. **The label in front of it is gone with the raw string**: the row's own `h3` names the
setting, and a line that repeats the name is a line the eye has to get past to reach the value.

**And the dialog's preview line went with it** (4.5.0). It existed so a hand-editor could see what
the dialog would make of their edit; there is no hand-editing from our side now, and the seven
selectors above it said the same thing in the same words. The settings row shows the value where a
value belongs.

**Proceed, Save and Undo are amber** (4.3.0), by the repo-wide rule the buttons on the page had
followed since 1.8.0 while these three - the only controls in the plugin that actually write -
stayed grey. See the repo-root CLAUDE.md under *one colour for "a plugin wrote this"*; the two
siblings' dialogs were painted in the same pass.

**The settings dialog's panel brings its own side padding** (4.1.1), because it is the modal's body
rather than part of the padded head the run dialog puts it in. `.npt-modesbody` wraps the panel and
the preview string; without it both sat flush against the modal border, which is the sort of thing
only visible in a live instance and looked exactly like a missing rule in the shared chrome.

**The recap lines split by direction** because one run can do both: `planTagCounts(plan, dir)` takes
the direction, `appliedTags`/`undoneTags` are `{ ADD: {}, REMOVE: {} }`, and an empty half prints
nothing. Up to 3.2.0 every one of those took its verb from the run's single `mode`, which a mixed
run has no equivalent of.

### Phase 1 — dry run

Modal, built as plain DOM appended to `document.body` with its own injected `<style>` (no React,
no PluginApi). It shows:

- A one-line backup warning at the top, permanently, not a dismissible notice: *"This cannot be
  undone. Back up your database before proceeding."*
- The task name, the seven selectors (§5c), and the entity types included in the run with the
  direction each one is being planned in, in processing order.
- Any run-level warning raised at startup — currently the sibling-plugin check in §8.
- Per-type progress: `Scenes 4200 / 12871`, plus a running "changes found" count.
- A scrollable log of every planned change, one line per tag per entity:
  `[REMOVE] Scene "My Scene" (123) - Tag "Hair Colour" (45) - due to "Platinum" (47)`
  `[ADD]    Performer "Jane" (7) - Tag "Blonde" (12) - due to "Platinum" (47)`
  `[ERROR]  Scenes page 5 - findScenes failed: ...`

  The **due to** clause names the tag already on the entity that implies the one being written -
  the entry's *reason*. Both the entity and the tag put their id outside the quotes, so a name
  containing brackets cannot be misread as one.
- A **legend** under the warning (`npt-legend`, 1.2.7) saying that the bracketed number is a Stash
  id and that counts are written `x250`. The convention was only obvious to whoever wrote it —
  `"Hair Colour" (45) x250` puts an id and a count on one line, and nothing said which was which.
  It states a rule the rest of the plugin has to keep: **brackets are ids, counts are not**. That is
  why the inspector's list headings read `Parents: 3` rather than `Parents (3)` (§5a) and why a
  failed batch logs `5 entities (ids 1, 2, …)`. A new surface putting a count in brackets does not
  merely read oddly, it makes the legend false. The sibling carries the same line, in the same two
  places (its dialog, and the console banner that stands in for one) — keep the wordings
  recognisable against each other.
- A closing **tag summary** as the last line of the phase, listing every distinct tag the run
  touches and how many entities each lands on:
  `[INFO] 2 tags to remove: "Blonde" (2) x1, "Hair Colour" (1) x250`

  The per-entity lines answer "what happened to this entity"; this answers "which tags did this
  run touch, and how widely", which is the question actually asked before trusting a Prune over a
  whole library — and the one a six-figure log cannot be read for.

  **Ordered the way Stash orders tags**, so the line reads straight against the tag list in the
  UI: `ORDER BY COALESCE(tags.sort_name, tags.name) COLLATE NATURAL_CI`. That means `sort_name`
  wins where it is set (it is nullable, never shown, and exists only to override the name for
  sorting — so a blank one is no override), compared case-insensitively and with numeric runs as
  numbers, hence `Volume 2` before `Volume 10`. `Intl.Collator({ numeric: true, sensitivity:
  'accent' })` is the browser's nearest equivalent; without `Intl` it degrades to a
  case-insensitive compare rather than throwing. The **id** is the final tie-break — Stash has one
  too, and two tags in different parts of the hierarchy may share a name.

  This is display order only. The id tie-break in `betterReason` is a different question — *which*
  tag to blame, not what order to print — and stays on the id.

  Phase 2 emits its own, counted from `appliedTags` — accumulated where a batch **succeeds**, not
  from the plan — so a failed batch or a **Stop** is not summarised as though it had landed. The
  two lines differing is meaningful, not a bug.

  **Its tags hover** (1.4.0), naming their aliases and description — the viewer's row tooltip, on
  the line the Proceed decision is actually made from. The mechanics:

  - `tagSummaryParts` returns segments instead of a string and `log()` takes an optional `parts`;
    `flush` builds a span per segment when it is there and keeps the plain `textContent` path for
    every other line. `lines` still gets the joined string, because Copy log hands over text.
  - **Only tags with something to add carry a tooltip** (`tagHasDetail`). The span already reads
    `"Body" (4) x3`; a tooltip repeating that would open on a hover to say what is already on the
    line. Nothing marks which tags have one — 1.4.1 removed the dotted underline and help cursor
    1.4.0 shipped with, because they read as decoration in a log that has none elsewhere — so a
    hover that opens has to earn it. The viewer's rows are the deliberate exception; see §5a.
  - **`loadTagDetail` fetches by id**, for the tens of tags a recap names rather than the thousands
    the hierarchy holds. This is the same rule as `tagQuery(settings, detail)` and it assumes
    `findTags(ids:)`; verify that against a live Stash like every other API assumption here.
  - **Failure is silent.** It buys a tooltip, not a run. The rejection handler resolves to an empty
    map and the line renders plain.
  - `reset()` bumps `pass` and `logTagSummary` captures it, so a recap whose query is still in
    flight when **Rescan** is pressed is dropped instead of landing in the next pass's log.

  The tooltip helpers live in their own section next to `tagLabel` rather than in the viewer, since
  1.4.0 made them two callers' code. The sibling has its own copy for the same reason its collator
  does: no shared module.
- Buttons: **Proceed** (enabled once the scan finishes, and disabled outright when there is
  nothing to do) and **Cancel** (abandons the run; during the scan it stops paging).

**Log volume is a real constraint.** A first run on a large library can plan six figures of
changes. Keep the full log in a JS array (that is what Copy exports) and render only the last
~1000 lines into the DOM, with a `showing last 1000 of 214503` note above it. Append in batches
on a timer rather than one node per change, or the scan is bottlenecked on layout.

Nothing is written in phase 1. The plan is held as
`[{ type, entityId, entityLabel, add: [], remove: [], reason: { tagId: tagId } }]`. `reason` is
narrowed to the tags actually being written rather than holding the entity's whole implied map —
a six-figure plan carrying an ancestor map per entry is a browser tab that runs out of memory.

### Phase 2 — apply

Only reached via Proceed. Same modal, log continues into a second section headed with the
timestamp, now recording what was actually written plus any errors.

Write with the **bulk** mutations in delta mode rather than per-entity full `tag_ids`:

```graphql
bulkSceneUpdate(input: { ids: [...], tag_ids: { ids: [...], mode: REMOVE } })
```

All seven types support it (`bulkSceneUpdate`, `bulkImageUpdate`, `bulkGalleryUpdate`,
`bulkPerformerUpdate`, `bulkStudioUpdate`, `bulkGroupUpdate`, `bulkSceneMarkerUpdate`), all with
`tag_ids: BulkUpdateIds` and `mode: SET | ADD | REMOVE`. Two reasons this beats a per-entity
`SET` of the full list:

1. `ADD`/`REMOVE` is a delta the server applies, so a tag someone added from another tab between
   the scan and the apply is not silently reverted. A full `SET` built from phase-1 data would
   clobber it.
2. Entities sharing an identical delta can be grouped into one mutation — and they usually do,
   because the same redundant parent tends to appear across many entities. Group by a sorted
   delta key, chunk `ids` at ~100, and issue chunks sequentially. This turns 50 000 mutations
   into a few hundred.

Per-chunk error isolation: a failed chunk is logged and the run continues. If a chunk fails,
none of its entities are logged as changed.

Chunks are applied in the §5 processing order, type by type — the grouping is by delta *within*
a type, never across types, since each type has its own mutation anyway.

Phase 2 buttons: **Copy log** (full array, not the rendered tail, via `navigator.clipboard`
with a `<textarea>` + `execCommand` fallback for non-HTTPS origins — Stash is commonly served
over plain HTTP on a LAN, where the async clipboard API is unavailable), **Rescan** (throws the
plan away and restarts phase 1 without closing the dialog), and **Close**. A **Stop** button
halts after the current chunk; already-applied chunks stay applied.

**There is deliberately no Clear log.** It existed until 0.10.0 and earned nothing: emptying the
buffer was only ever wanted before a Rescan, which emptied the rendered view anyway, and once phase 2
has written something the log is the only record of what changed — Stash has no undo and the plugin
cannot reconstruct the list. **2.3.0 strengthened this rather than reopening it**: a Rescan no longer
empties anything, and "the log stays until the dialog closes" is now the stated design, so a button
whose only job is to break that promise has less of a case than it had when it was removed. A button whose whole safe use is covered by another button, and whose
unsafe use needed an arm/confirm latch (`run.wrote`, `CLEAR_ARM_MS`) to be survivable, is a button
worth removing rather than guarding. Its class also collided with the tree view's `.npt-clear`
input icon, which is what made the cost visible. Do not reintroduce it without a use Rescan does
not already serve.

**One counter, since 2.3.0.** `lines` is the export buffer and survives a Rescan, because Copy log
hands over the whole session — and the rendered log now survives one too, so `lines.length` is what
the progress line describes: both the `N log lines` figure and the `showing the last 1000 of N`
clause.

There were two until 2.3.0, and the second was not redundant while it existed. `viewLines` counted
what had gone into the log *since the current pass emptied the view*, because reporting `lines` over
an emptied view was wrong in a way that only showed up at scale: a pass that applied 28 000 lines
followed by a rescan finding nothing left the header claiming 28 161 lines and 27 161 hidden, over a
log holding four. **Keeping the view removed the divergence rather than the symptom** — nothing
empties the log now, so the two counters could only ever agree, and one of them had to go.
`normalize-apply` pins that the progress figure equals what Copy log hands over, which is the check
that would notice them parting again.

**A rescan starts a pass, so every per-pass surface has to be re-derived, not just added to.**
`reset()` handles the counters and `rescan()` clears the rendered log, but the head of the dialog
is written straight to the DOM: `begin()` blanks `noteEl` and repaints the progress line before
anything is loaded. The sibling warning is the reason — it tells the user to turn auto-merge off
and rescan, so leaving it up after they have done that reports a run as unsafe when it no longer
is. Anything else parked in the head needs the same treatment.

**Rescan is not a convenience.** The whole plan is computed before the first write, so anything
that changes tags *during* phase 2 — the sibling plugin in §8, another browser tab, a running
scan — is invisible to the plan that is being applied. Rescan is how the user converges: run,
rescan, see an empty plan, and know the library is normalized.

### Phase 3 — undo (0.12.0)

The dialog can take its own writes back. It exists because the review pass answers "is this what I
meant?" only as well as the user reads it, and a six-figure log is not read closely — the first
honest signal that a Prune was misconfigured is the library afterwards.

**It is the apply, inverted.** `applyBatch` records each batch the server accepted on `undoable`;
`undoBatch` replays it with `ADD` and `REMOVE` swapped. Nothing else is stored, and nothing is
recomputed — the batch *is* the record, which is why the grouping that made the apply cheap makes
the undo cheap too.

**A delta, never a restore.** It would have been simpler to keep each entity's pre-run tag list and
`SET` it back. That is wrong: it would revert every unrelated edit made in between, which is the
one thing an undo must not do. `ADD`/`REMOVE` touches only the assignments the run itself changed,
for the same reason phase 2 writes deltas in the first place (§5).

**Newest batch first.** A rescan-and-apply cycle can write to one entity twice, and taking the
second write back before the first is the only order that lands where the run started.

**Recorded on success only.** A failed batch changed nothing, so it must not be reversed —
otherwise a `REMOVE` that the server refused would be "undone" by an `ADD` that puts a tag
somewhere it never was. This is the same discipline as the applied tag recap being counted from
writes rather than from the plan.

**Session-scoped, like `lines`.** `reset()` clears it and `rescan()` saves it across the call.
Converging on an empty plan is the normal way to finish a run, and losing the ability to undo at
exactly that moment would be the worst possible time.

**Offered in `ready` as well as `done`,** because a rescan leaves the dialog holding a fresh plan
over a library the previous pass already changed — precisely when the user is choosing between
applying more and taking back what is there. It always finishes in `done`: a plan reviewed against
the library as it was no longer describes it, so Rescan is the honest next step rather than a
Proceed left armed over stale ground.

**It arms and asks.** One click sets the caption to `Undo N changes?`, a second within
`UNDO_ARM_MS` carries it out, and Rescan/Close disarm it. This is the same mechanism removed from
Clear log at 0.10.0 and the reasoning is not in tension: Clear log's safe use was covered by another
button and its unsafe use was discarding a log, whereas Undo has no alternative and starts a
library-wide write from the state where Copy log, Rescan and Close are its immediate neighbours.
The count is what earns the prompt — it states the scope rather than asking a generic "are you
sure".

**It takes a lease** labelled `<task> (undo)`, because it is a bulk write like any other (§8).

**The head warning changed with it.** "This cannot be undone" was true and is no longer, so it now
leads with the backup instruction and states Undo's three limits — own writes, open dialog, blind
to concurrent changes — rather than leaving them to be discovered.

## 5a. The hierarchy viewer (0.7.0)

A read-only third task, `Show Tag Hierarchy...`, on the same entry-point machinery as the other two.
It answers the questions the other two raise — *which tags does Prune consider redundant, why was
that one left alone, where are the diamonds* — against the same graph they run on.

**Deliberately not a node-link graph.** A real tag DAG is a hairball past a few hundred nodes, and
drawing one needs a layout engine this repo has nowhere to put: no build step, no bundler, no
runtime dependencies, and a plugin folder is copied as-is. A tag DAG is also *mostly a forest*, so
a tree is the honest shape and the handful of multi-parent tags are marked rather than hidden.
It shipped with **Copy as DOT / Copy as Mermaid** beside that, for anyone who did want a drawn
graph in a tool built for it. **2.2.0 removed them**, on live feedback: at real library size the
drawn result was unreadable too, so the escape hatch let out into the same hairball the tree exists
to avoid. Reintroducing them needs an answer to legibility, not another output format.

How the DAG survives being drawn as a tree:

- A tag with several parents is drawn in full under its **primary parent** — the first in Stash's
  own sort order, so the choice is stable between runs — and appears under every other parent as a
  `↩ shown under X` row that does not expand. Without that, a diamond duplicates its whole subtree
  once per path.
- The real row carries `◆ n parents`, which is where Prune surprises people: every parent on every
  branch is implied.

**The row tooltip carries name, id, aliases and description** (1.3.0). The row itself can only show
a name and an id, and neither answers "is this the tag I think it is" for a scheme with namespaced
duplicates. Three rules hold it together:

- **Both free-text fields are capped**, aliases at eight names or `TIP_ALIAS_CHARS`, whichever cuts
  first, and the description at `TIP_DESC_CHARS` on a word boundary. A tag with forty aliases would
  otherwise put a wall of text under the pointer, which is worse than the id alone.
- **The tail is counted, never dropped.** `and 4 more` is what stops a truncated list from reading
  as a complete one, and it is why the aliases are filtered for blanks *before* the count is taken.
  The first alias is always named, excerpted if it has to be — `and 12 more` listing nothing is not
  a tooltip.
- **`aliases` and `description` are fetched only by the viewer**, through `tagQuery(settings,
  detail)`. A description is free text and can run to paragraphs; asking for one per tag on every
  prune of a library with thousands of them buys a payload no code path reads. Same rule as
  `custom_fields` being conditional, and as counts being opt-in below.

**It says when it is stale, and gates nothing** (1.5.1). The run dialog's version check disables
Proceed; here there is nothing to disable, since the viewer writes nothing. What it has instead is a
different failure: every badge and every inspector verdict answers *what would Prune do with this
tag* out of the filter rules in this script, so a tab left open from before an update explains the
old behaviour with complete confidence — and a viewer is exactly the kind of thing left open in a
background tab. So `TreeView.checkVersion` puts a warning above the read-only line and leaves every
control working: blocking the one tool that helps while the install is sorted out would be a poor
trade. Both dialogs go through `checkInstalledVersion`, which settles unknown-and-matching on the
console; they differ only in what they do about a mismatch.

**A row is `Name (id)`, a badge is a count** (1.2.7). This dialog is the one place where the two
kinds of number sit side by side on the same row — `Hair Colour (45)   2 children` — so it says so
in the head, the tag name carries a tooltip repeating the id, and the inspector's list headings were
changed from `Parents (3)` to `Parents: 3`. That last one was the actual bug: a heading in brackets
over a list of tags, in a dialog where brackets mean ids, reads as the tag with id 3. Keep counts
out of brackets here, or the head legend is lying about the row beneath it.

**Both of those badges are jumps** (0.9.0). A count of three parents that cannot be followed leaves
the user knowing a tag hangs off three branches and with no way to see the other two — the badge
states the problem and withholds the answer. `◆` walks to the **next** parent in sort order counting
from the row it is on, so it is stateless (the row knows its own `under`) and n clicks tour every
branch and come home; its tooltip names them all, since a tour is not a choice. `↩` goes to the full
copy it already names. Both are on repeat rows too, so the walk continues from wherever it landed —
which is why the `◆`/`↩` badges are no longer an `else if` pair.

`jumpTo(id, under)` is the single navigation primitive — reveal, select, render, centre — and Find
calls it with a null `under` meaning "wherever it lives". `under` is what makes an *occurrence*
addressable rather than a tag: `render()` keeps `occNodes[id][parentId]` alongside `rowNodes[id]`,
and `centerOn` falls back to the tag's own row when the occurrence is not drawn (its parent is in a
cycle, so it is never walked into). `rowNodes[id]` prefers the real row over a repeat explicitly;
which of the two is drawn last depends on where the parents sit in the tree, not on their sort
order, so the old "last one wins" comment was true only by accident.

**The inspector's own title is the way *out* of the viewer** (2.4.0) - a link to the tag's page,
opening in a new tab. Everything else in this dialog navigates the tree; this is the one control
that leaves it, which is why it is also the one that must not take the tab with it.

Every tag named in the inspector is a jump as well. That is the direct way to reach *one particular*
parent, where the badge is the tour — the two gestures are worth having both of, and the inspector
is where the parents are already listed by name.
- **Cyclic tags are surfaced as roots.** They are unreachable from any real root, so a tree that
  only walked downwards would hide exactly the tags both tasks refuse to touch — the one case
  where a viewer earns its keep.

**Badges come from `filters.protections(id)`, not from a second copy of the rules.** `makeFilters`
returns a reason string rather than a bare boolean (`blockReason`), so the viewer can say *which*
filter protects a tag and can never drift from what the run will actually do. That is the whole
value of the badge; a re-implementation that agreed today and diverged in six months would be worse
than no badge.

**Nothing may assume the graph is there.** `build()` wires every control and *then* calls `load()`,
so both boxes and all five footer buttons are live before the tag query answers — and stay live
forever if it fails, since the dialog remains open showing `Could not load tags`. Every entry point
that reads the graph is gated on `ready()`; without it a keystroke in either box threw
`Cannot read properties of undefined (reading 'byId')` into the console on every character, with
nothing visible to explain it. `render()` is gated too, so a future caller cannot reopen the hole.

**Counts are opt-in.** `scene_count` and friends are per-tag resolver fields and one query over
thousands of tags is the expensive thing in this dialog, so they load on a button. `depth: 0` is
passed **explicitly**: the count is for the tag itself rather than for it plus everything beneath
it, and the server's default for an omitted `depth` is not documented in the schema — an ambiguous
number on screen is worse than no number.

**The button says what a click does, before and after** (2.2.0). It read `Counts loaded` once they
had — a *status*, on the one control whose caption is read to decide whether pressing it again is
worth anything, and pressing it does re-fetch. It is `Refresh counts` now, and a failure falls back
to whichever of the two the dialog is actually in. Being the only control here that costs a query,
it is also the only one carrying a `title`: what it fetches, that it is one query over the whole
tag list, and that the numbers exclude descendants — the `depth: 0` fact above is the one users
misread, and it was nowhere on screen.

**Find and Filter are two gestures, not one control with a mode.** Find *navigates*: it opens the
path to the match through the same primary parents the tree draws it under, selects it, and centres
the row (`scrollIntoView({ block: 'center' })`, with a manual `scrollTop` fallback). Filter
*reduces*: it throws the tree away for a flat list of matches. Conflating them would cost whichever
half the user wanted this time. Find clears an active filter before jumping, because "show me where
this tag lives" cannot be answered from a flat list — that is the one place they interact, and it
is the direction that keeps the request honest.

Both boxes are built by `clearableInput()`, which wraps the input and its × in a
`position: relative` container. The icon used to be pinned to the row itself, which worked only
while the row held one box - the moment Find was added beside Filter, that icon would have sat over
the wrong input. Clearing Find drops the box and the counter but leaves the tree where the find took
you: it is a way to stop searching, not an undo.

**Both boxes are case-insensitive; the exclusion filters are not.** They look similar and are
deliberately different: the box locates a tag a human is looking for, and nobody types a namespace
marker's exact case to find one. The filters decide what gets written, where matching loosely would
protect or skip tags by accident — see §4.

## 5b. Auto mode (1.1.0)

`a1AutoModes` (§6a) makes the plugin **reactive** as well as bulk: it wraps `fetch`, and every
entity Stash saves is re-normalized in that type's direction immediately. The task answers
"normalize my library once"; this answers "and keep it that way". It was two global booleans,
`a8AutoPruneOnUpdate` and `a9AutoRollUpOnUpdate`, until 4.0.0.

**This breaks the invariant the rest of the plugin is built on.** Everywhere else, nothing is
written without a plan on screen and a Proceed, and §5's Undo exists because a six-figure review log
is not read closely. Out here there is no dialog, so there is no review, no tag summary and no Undo —
a `[REMOVE]` line in the browser console is the entire record. A type set to PRUNE in particular
deletes tag assignments one save at a time, silently. The setting's description says so in those
words, and so does the head of the **Auto Mode Settings...** dialog; they are the only warning the
user gets, so do not trim them for length.

**Since 1.7.5 that warning sits in the tooltip half of the description, not the visible half.** It
was moved there deliberately (§6) and the wording survived intact; what changed is that reading it
now costs a hover, and a touch device has no way to reach it at all — which is part of why the
settings dialog's head carries it too. If the description is ever rewritten, the warning goes with
it: moving it is not licence to shorten it.

**Which types are covered, and in which direction, is the one string.** Up to 3.2.0 this section
argued for the opposite arrangement - one list of enabled types shared with the tasks, so the
settings page could not describe two different libraries - and named its own cost: *you cannot
auto-prune only scenes while the task covers everything*. That cost is what 4.0.0 removed. The
sharing survives in the form that was actually load-bearing: **the task dialog starts from these
modes**, so the two still agree by default, and a run that differs is one the user changed on
screen, in front of the plan it produces. The all-off default is unchanged - a fresh install reacts
to nothing until the user has said which types they have thought about.

Both single and bulk mutations are watched (`sceneUpdate` *and* `bulkSceneUpdate`), so a bulk edit
of 500 scenes normalizes all 500. That is usually the point, and it is also the largest silent write
this plugin can make without a dialog.

### Watching the mutations

`TYPES` gained a `single` field to go with `bulk`. The two never collide under a `\b`-anchored
regex because Stash capitalises the type inside the bulk name: `bulkSceneUpdate` does not contain
`sceneUpdate`, and neither contains `sceneMarkerUpdate`. The regexes are compiled once and cached on
the type (`autoRe`) — the wrapper runs on every GraphQL request the page makes, and compiling
fourteen of them per request is a cost paid overwhelmingly on queries that never match.

`mutationSucceeded` is copied from the sibling and for the same reason: `fetch` resolves for HTTP 500
and for GraphQL errors returned with HTTP 200, so "the request came back" is not "the edit was
saved". Normalizing a save Stash rejected would write changes the user never made.

**Known gap: `scenesUpdate` / `imagesUpdate`** — the array-input plural mutations — are not watched.
Stash's UI does not use them for tag edits. If that changes they need their own branch, reading ids
out of an array of inputs rather than one `input.ids`.

### Reading entities

Every plural find query takes `ids: [ID!]`, markers included, so `autoEntityQuery` fetches exactly
the touched entities in one request and `planEntity` runs against them unchanged. No paging, no
`count`, and no second planning implementation — `planEntity`, `buildBatches` and `applyBatch` are
the same code the tasks use. `applyBatch` writes into an `autoSink()` instead of a `Run`: same
fields, console instead of a DOM. Its `undoable` array is collected and dropped, because there is no
dialog to offer it from.

Those console lines are the dialog's lines, so they need the dialog's legend and have no head to put
it in. `autoLegend()` prints it once, from the first `log()` any sink makes — once per page rather
than once per reaction, since a mode that reacts to every save would otherwise repeat it forever, and
a line printed only at load would scroll away long before the first write it explains. The flag is
module-scoped for that reason: `autoSink()` returns a fresh object per reaction and could not carry
it.

### Caching

The tasks read settings once per run. Auto mode has no run to hang that off, and no main loop
either — the tasks were the only entry point until now. So both reads are cached on demand rather
than polled: settings for `AUTO_SETTINGS_TTL_MS`, the tag hierarchy for `AUTO_GRAPH_TTL_MS`. **An
idle tab issues no queries at all**, which is better than the sibling's 10s timer, and the price is
that a settings change takes up to ten seconds to take effect.

The graph cache is also **invalidated outright by any tag mutation** seen in the wrapper. Without
that, a parent created in another tab would be ignored for a minute — and a plugin whose whole
subject is the hierarchy cannot be a minute behind it.

### The three things that stop it eating a library

There were four until 4.0.0. The first was **both modes on does nothing** - the two global flags
were exact inverses, so whichever ran second undid the first on every save, and `autoMode` returned
null and warned once rather than picking one silently. A type now carries one of three values, so
the combination cannot be configured, and the guard, the console warning, the settings-page notice
and two siblings' copies of the same explanation all went with it. **The best fix for a state that
has to be documented as a no-op is a setting that cannot express it.**

1. **`guarded()` / `_writeDepth`**, the internal re-entrancy guard, modelled on the sibling's
   `_mergeDepth` and a counter for the same reason. It wraps the auto writes *and both task write
   paths*: phase 2 and Undo issue `bulk*Update` for every batch, which is precisely what the wrapper
   watches for, so without it a Prune task with Auto Prune enabled re-plans each batch it has just
   written — and an Undo would have its reversal put straight back.
2. **A lease**, so other reactive plugins stand down while we write. This is what stops the
   sibling's auto-merge from bouncing a prune straight back. It is short — `AUTO_LEASE_TTL_MS`, not
   the tasks' five minutes — because a crashed tab must not stand the sibling down for five minutes
   over one scene save. We honour our own lease no differently from anyone else's; §8 explains why
   that is correct rather than a self-inflicted deadlock.
3. **A per-entity cooldown**, for when 2 is not honoured. A plugin older than the protocol, or a
   server-side `hooks:` plugin that never sees this `window`, can still write our removals back.
   Without a cooldown, Prune and that plugin ping-pong over one entity for as long as the tab is
   open. After writing to an entity we ignore further updates to it for `AUTO_COOLDOWN_MS`, which
   caps the exchange at one round and leaves the other plugin's write standing — the safe direction,
   since it means fewer deletions rather than more.

Only entities we **wrote to** go on cooldown, never everything a mutation touched: marking an entity
we planned nothing for would suppress a later, legitimate reaction to it. The map is swept of
expired entries once it passes `AUTO_COOLDOWN_MAX` rather than capped, since a bulk edit can put
tens of thousands of ids in it and each expires on its own schedule.

Note that 1 and 3 overlap on the auto path — a self-reaction always targets ids marked a moment
earlier, so either alone would stop it. They do **not** overlap on the task path, where nothing
marks a cooldown, and that is where `_writeDepth` is doing work nothing else does. The test suite
says so explicitly, because a check that passes for the wrong reason is worse than no check.

### Keeping the field honest on the settings page (1.2.0, rewritten at 4.0.0)

Up to 3.2.0 this was a **notice**: both auto modes on ran neither, which was the safe reading and an
invisible one, so `settingsTick()` put a warning inside the plugin's own `SettingGroup` for as long
as both were ticked. There is no such state any more (see above), and what the tick does on that
page now is the opposite job - **`normalizeSettingField()` writes the parsed value back in canonical
form** once Stash has saved a hand edit, which is also how the user finds out the plugin understood
what they typed.

**It reads the input, not the saved settings.** That was the notice's own hard-won rule and it
transfers exactly: the input's `value` is the state the user is looking at, it costs nothing, and it
lags by nothing, where Stash sets its own React state immediately and debounces the save, so
anything re-reading the config is behind the box and disagrees with the screen while it is.

Three rules stop it fighting the person typing, and they are the whole design:

- **Never while the field has focus.** A value replaced under the cursor is one the user cannot
  finish typing.
- **Never twice for the same text.** The write is remembered by what it was made *from*, so a Stash
  that does not re-render the field with the saved value cannot turn this into a loop.
- **An empty field is left alone.** It means "nothing configured", which is what a fresh install
  has; writing seven OFFs into it would be the plugin saving settings for someone who has only
  looked at the page.

**Automatic rewriting of another plugin's - or this one's - settings is otherwise still refused**,
and the three reasons the notice recorded are unchanged and worth keeping, because the idea comes
back:

- Plugin settings are **server-side and shared** by every tab and every user of that Stash.
- `configurePlugin(plugin_id, input)` exists, but Stash's settings page holds plugin config in
  **React component state** (`SettingStateContext` → `setPlugins`), not in the Apollo cache. An
  out-of-band write therefore leaves the *displayed* value stale until a reload.
- Driving Stash's own `onChange` through `PluginApi.patch` would keep the UI honest and is the only
  version that fully works.

The renormalization is the one write that clears that bar, and only just: it changes the spelling of
a value the user has already saved, never its meaning, and the field going stale until a reload
shows the text they typed rather than a state they did not choose. The **migration** in §6a is the
other, and it is a one-off.

There is also no way to collapse seven tri-states into seven controls: `PluginSettingTypeEnum` is
`STRING | NUMBER | BOOLEAN`, so Stash has no dropdown for a plugin setting - which is exactly why
the modes are a string and the **Auto Mode Settings...** dialog exists.

> **A detour worth not repeating.** 1.2.3 and 1.2.4 both tried to make a *config-derived* notice keep
> up with a click — first by invalidating on `configurePlugin`, then by polling settings once a
> second while the page was open. Neither helped, because the delay being chased was a stale
> `NormalizeParentTags.js` in the browser, not the cache. The version in the settings group heading
> comes from the manifest and reloads instantly, so it read the new version throughout while the old
> script ran. Two lessons: **get one measurement off the live instance before shipping a second fix
> for the same symptom**, and remember that a plugin's *displayed* version proves nothing about the
> code running. The per-second poll is gone; the invalidation stayed only because auto mode wants it
> for its own reasons.

**A settings save invalidates the settings cache** — the `fetch` wrapper watches for
`configurePlugin` carrying our own `plugin_id` and drops it. This is nothing to do with the
renormalization above, which reads the DOM: it is for **auto mode**, which caches settings for `AUTO_SETTINGS_TTL_MS` and
would otherwise keep writing under the old ones for up to ten seconds after you enable a mode. Two
details: re-read only **after** `mutationSucceeded`, or the old values come straight back and are
cached for another ten seconds; and scope it to our `plugin_id`, since the settings page saves each
plugin in its own mutation.

Mechanics worth keeping: the group is found by a **heading carrying the plugin name**, never by
position, since the page lists every installed plugin — the same rule as the task interception in
§2.

**Anchor on the setting element ids, not on any heading.** `SettingsPluginsPanel.tsx` gives every
plugin setting an id built from the plugin id and the setting key:

```jsx
id: `plugin-${pluginID}-${setting.name}`   // plugin-NormalizeParentTags-a1AutoModes
```

That is ours by construction — no version suffix, no localisation, nothing formatted for display.
`ownSettingGroup()` finds one of ours and walks up to the enclosing `.setting-group`. Finding it is
*also* what tells us the plugins settings page is showing, so there is no route test either; that
was one more assumption with nothing checking it, and those ids cannot exist on another page.

**And it falls back to the heading's group when there is no id at all** (4.0.0). That fallback used
to exist only for the both-modes notice, and it outlived it: everything else this section puts on
that page - the README link, the description split, the per-setting tooltips, the stale-script
banner - needs the same box, and a Stash that stopped setting those ids would have dropped all of
them silently. It is what `normalize-auto`'s five heading spellings now check.

**The fallback has to exclude the Tasks page, and finding out why was worth the check.**
Settings → Tasks heads *its* group with the same plugin name, so the heading alone matches both
pages - and decorating the wrong one is not cosmetic. `readmeLinkSlot` picks a slot by structure,
and in a tasks group that slot landed **inside the task button**, so the link became the button's
only child and the button's label became "NormalizeParentTags/README.md". `ownTaskName` matches on
that label, so the button stopped being ours: no interception, no amber, a click queueing a
server-side job for a plugin that has nothing to execute. `hasOwnTaskButton` is the discriminator -
the heading says who we are, the buttons say which page - and the suite pins both halves, including
that the button is still repainted, since painting is a different function asking a different
question.

Anything placed *inside* the group has to reckon with the `<Collapse>` that `SettingsPluginsPanel`
shuts by default: a notice in there is invisible until the user expands the very group it is
telling them to look at. The group header is outside it, which is why the README link and the stale
banner sit there.

**The id anchor has one failure mode of its own, and 4.0.0 walked into it in the siblings**
(4.0.1). This plugin renamed all nine of its setting keys, so a 3.2.0 script still running in an
open tab could not find its own group on the new settings page — and the first thing it therefore
did not draw was the **stale-script banner**, on the one release that most needed it shown. The
heading fallback above is why it cannot happen here again; `MergePerformerTagsToScenes` 3.3.1 and
`PropagateTagsAndPerformers` 2.3.1 took the same fallback, `hasOwnTaskButton` guard included, for
the same reason. **A diagnostic must not be reachable only through something a release can rename**
— the generalisation is in the repo-root file.

**Two releases shipped this broken by matching the heading text instead, and the tests agreed with
the bug both times** — they were written from the same guess as the code, so they modelled a DOM
Stash never produces. The heading match survives only as a fallback for a Stash that does not set
those ids, and `normalize-auto` now builds the real structure: group box, header, collapsed section,
and inputs carrying the real ids. Removing the id anchor fails the placement checks; the old
heading-only matcher failed seven.

**The two pages do not head that group the same way, which is what broke 1.2.0.**
Settings → Tasks passes the name straight through (`heading: o.name` in `PluginTasks.tsx`), but
Settings → Plugins appends the version:

```jsx
heading: `${plugin.name} ${plugin.version ? `(${plugin.version})` : undefined}`
```

so the `h3` there reads `Normalize Parent Tags (1.2.0)` — and, since that template interpolates the
literal when a plugin has no version, sometimes `Normalize Parent Tags undefined`. Matching the bare
name found neither, so the notice this fallback was built for never appeared. `headingIsOurs` strips the suffix and compares
**exactly**; do not relax it to a prefix test, or a plugin called `Normalize Parent Tags Extra`
becomes us. All five spellings are pinned in `normalize-auto`, and both the original bug and the
prefix-match "fix" fail those checks.

The lesson generalises: every one of this plugin's footholds in Stash's markup is a guess until it
runs against a real Stash, and a test written from the same guess confirms nothing. When a DOM
assumption is added here, read the component that produces it. Rendering is idempotent, because the tick runs on a timer and on every navigation. Settings are
only read while that page is showing, so a tab parked anywhere else costs two string comparisons a
second and no queries. There is deliberately **no MutationObserver** here, unlike
the sibling's button injection: a banner in a settings panel does not have to land before the user
can click it, so the timer plus the navigation hooks are enough and cannot fight a React re-render.

### The exclusion tag

`b1ExcludeEntityWithTagName` resolving to nothing **stops auto mode** rather than letting it run
unfiltered, exactly as it aborts a task run — running unfiltered would touch the very entities the
user asked to protect. The dialog can stop a run and say so; out here there is nothing to stop, so
it warns once to the console and keeps refusing quietly until the setting is fixed or cleared.

## 6. Settings

All settings are re-read at the start of every run (a single `{ configuration { plugins } }`
query — Stash cannot scope it to one plugin), not on a timer. The tasks are the only entry
point, so there is nothing to keep warm between runs.

**The `a1`/`b2`/`c3` key prefixes are load-bearing.** `settings:` is a YAML *map*, so the order
the manifest declares them in is gone by the time Stash has parsed it; the settings page renders
the keys **sorted alphabetically**, ignoring `displayName` and ignoring the setting type. Without
the prefixes the page interleaves the list in the order `enableGalleries … enableMarkers,
enablePerformers …`, which puts Scene Markers between Images and Performers and drops the
Organized toggle into the middle of the string filters. The prefixes buy three blocks the user
can read top to bottom:

- `a1` — the automatic modes, all seven types in one string (§6a). It was `a1`–`a9`, nine booleans,
  until 4.0.0.
- `b1`–`b2` — the entity-level exclusions.
- `c1`–`c6` — the tag-level filters: the both-directions one first, then the add/remove name pair,
  then `c4TagNameSeparator` directly under the two settings it splits, then the add/remove
  custom-field pair.

`c4TagNameSeparator` arrived last and was briefly `c6`, appended to avoid renumbering. It was moved
under `c2`/`c3` at 0.6.0, pushing the custom-field pair to `c5`/`c6` — a deliberate exception to the
rule below, taken while the plugin was still unreleased and the only install was the author's. That
window is closed for the next one.

Keep the YAML block itself in key order too. It is not what Stash reads, but a block that reads
differently from the page it produces is a trap for the next edit.

A key is also the **storage key** — Stash saves values under it — so renaming one silently
resets that setting for every existing install and strands the old value in the config. Renaming
happened once at 0.1.1, while the only install was the author's, and once at 4.0.0, where all nine
`a` keys went at once — **with a migration that reads the old ones and writes their meaning into
the new one**, which is the only way this should ever be done to a released plugin. New settings get
a prefix in the block they belong to; if there is no gap left, renumber the whole block in one go
rather than bolting on a `c5a`.

**A new key has to be added to `DEFAULTS` as well.** `loadSettings` copies only the keys that table
declares, so a setting present in the manifest and missing from `DEFAULTS` reads as empty forever —
configurable in the UI and inert in the run. `c4TagNameSeparator` shipped that way for one test run;
the suite caught it because the separator case was written to fail without the feature.

### 6a. The auto-mode string (4.0.0)

`a1AutoModes` holds all seven types: `PERFORMERS=OFF, STUDIOS=OFF, GROUPS=OFF, GALLERIES=OFF,
SCENES=PRUNE, IMAGES=OFF, MARKERS=OFF`. Everything about its shape follows from one fact:
**`PluginSettingTypeEnum` is `STRING | NUMBER | BOOLEAN`** — no tri-state, no enum, no repeated
group — so seven tri-states are either fourteen checkboxes with an illegal combination in each
pair, or one line of text.

**Parsing forgives, formatting does not.** `MODE_PAIR` picks `<type>=<mode>` out of anything, so
order, case, separators and surrounding prose are all free; `typeByToken` accepts the singular
(`SCENE`); `ROLL UP`, `ROLL-UP` and `ROLL_UP` all read as `ROLLUP`; an unknown word is ignored
rather than guessed at; a type named twice takes its **last** mention, because a line like this is
edited by appending far more often than by rewriting; and a type nobody mentioned is OFF.
`formatAutoModes` writes the seven pairs in processing order, joined with `', '`, always.

**`settingsFrom` is the one place the two meet**, so nothing downstream parses the string twice:
it fills the defaults, migrates a pre-4.0.0 install, and hangs `modes` off the result. `modeOf(s,
type)` is what everything else asks.

**The migration.** `hasLegacySettings` + `legacyModes`: an enabled type takes whichever single auto
mode was on; both on migrates to **OFF**, since that combination was 3.2.0's own documented no-op
and picking a direction the user never chose would be worse than the reset this is avoiding. It
runs once per page, only when the new key is empty, and writes the result back with
`saveAutoModes` — the old keys are left where they are, harmless and unread, because deleting a
user's data to tidy up is not this code's business.

**`saveAutoModes` is the only mutation this plugin sends that is not about the library.** It is
`configurePlugin` with our own `plugin_id`, which the fetch wrapper already watches for, so a save
made here drops the settings cache exactly as a save made by hand does.

**The Auto Mode Settings... task is the editor**, and it is why the string is acceptable as a
setting at all: nobody has to type it. It reads the current value with `loadSettings` (not the
10s-cached `autoSettings` — this dialog is where the user finds out what is configured, and a
stale answer here would be a lie they then overwrite), shows the seven selectors and a preview of
the exact string Save would write, and saves nothing until Save is pressed. Its head warns about
what an automatic mode does; it deliberately does **not** carry the backup instruction, because it
writes a setting rather than the library — see the repo-root rule, and §1.

**And it refuses to save with a stale script** (4.0.1), which is a sharper gate than the run
dialog's. Save does not *add* to this setting; it rewrites the whole line from the entity types and
modes the running script knows about, so a newer installed version that had grown an eighth type or
a third mode would have it dropped — silently, with nothing on screen showing the loss. The run
dialog at least prints the plan it would write. So the same `checkInstalledVersion` runs from
`build()`, the box goes above the note (the note reports on *reading* the setting; this says the
answer will not be written back whatever it says), and **the selectors stay live** — the string can
still be read off the preview, which is most of what someone opens this dialog for.

**The field carries an amber bar when something is armed** (4.1.0), which is the third answer to a
question 4.0.1 and 4.0.2 both got wrong. `.npt-armed{box-shadow:inset 3px 0 0 #ffc107}` — **inset**,
so it is drawn inside the element's own padding box and cannot be read as something the page draws
between rows; **`box-shadow`** rather than a border, so nothing reflows when it appears or goes; and
**no `!important`**, because Bootstrap's focus ring is also a box-shadow and taking the element over
while it has focus is correct.

**It is a state, not a label, and that is what makes it worth having.** An all-OFF setting writes
nothing by itself and wears nothing; a marking that were always there would say only "this is the
auto-mode setting", which the label already says. The field reads its own `value` through
`parseAutoModes` rather than the settings — free, live, and it follows what is being typed instead
of a debounced save, so it lands even on the focused field the renormalization deliberately leaves
alone.

**The same bar goes on the Auto Mode Settings... button, and that is why that button is teal.**
Amber means "this rewrites the library"; that task edits a setting, and whether the library is being
rewritten on its own is exactly what the bar answers — on an amber button it would have nothing to
say, because it could not be seen. So `paintTaskButtons` now picks amber for `TASK_RUN` alone. The
button's answer comes from `autoSettings()`, asked once when a button of ours is first on the page
and again after `invalidateAutoSettings` (which the plugin's own save already triggers): the tick
runs every second, and asking it each pass would be six queries a minute to colour a button. `_armed`
starts `null` and the mark stays off until an answer lands — a guess would be wrong in the direction
that matters, claiming nothing is armed.

**The two attempts it replaces, kept because the reasoning is the transferable part** (4.0.2). The repo convention is amber for a
setting that makes a plugin write on its own, and this is the only one here that does — but the
convention was written for a Bootstrap switch, where the colour goes on a track that is ours alone.
On a text field the only property available was `border-color`, and 4.0.1 used it: live, the field's
border *is* the line the user reads as the divider between that setting row and the next, so the
mark read as a broken separator rather than as a warning. **On a page that is not ours, only paint a
property nothing else on that page is drawing with.** The two switch shapes stay in the CSS — they
cost nothing and cover a Stash that renders this as a control — and `tests/style.test.js`
deliberately does not pin *which* settings are coloured, so dropping one was not a drift — and
neither was picking a different property for it a release later.

### Descriptions: a summary on the page, the rest on hover (1.7.0)

Seventeen settings averaging 220 characters — four of them over 340 — is a wall of prose that has
to be read past to reach the next checkbox. Since 1.7.0 a description written as
`summary\n\ndetail` shows **only its first paragraph**, with the rest moved into a tooltip, and the
group description shows its first paragraph behind a **Show more** toggle.

Measured over the whole settings block, the visible text drops from 3705 characters to 1110.

**The slot already exists and Stash never fills it.** `Inputs.tsx` renders `<h3 title={tooltip}>`,
but `SettingsPluginsPanel.tsx` builds only `{ heading, id, subHeading }` for a plugin setting, and
`PluginSetting` in `plugin.graphql` is `name / display_name / description / type` — there is no
field to declare a tooltip in the yml. So the slot is filled from the DOM, in the same tick that
injects the README link.

**The box is built, not borrowed** (1.7.1). 1.7.0 put the detail in a native `title` on the mark,
which was the wrong instinct: a native tooltip's font size, position and delay all belong to the
browser and **none of them can be reached from CSS**. It opens below-right of the pointer — exactly
where the arrow and the `cursor:help` question mark sit — so the first line arrives half covered.
`.npt-tipbox` is an element instead: readable size, opening *above* the row, clear of the pointer.
It also opens on **keyboard focus** (`.npt-tip` carries `tabIndex`), which a `title` never could.

**One row, one tooltip** (1.7.3). Every hover target on the row — the mark, the setting's *name*,
and the visible summary itself (1.7.4) — opens the same box. 1.7.1 left a plain `title` on the
`<h3>`, so a row had two tooltips showing the same words in two different presentations, one of them
the small browser tooltip the box was built to replace. Stash's `<h3 title>` slot is now left empty.

Hovering the summary is safe *because* the box opens above the `.sub-heading`: it covers the name,
never the sentence being read. A box that opened downward could not have taken the summary as a
trigger without getting in its own way.

Three details that are not arbitrary:

- **Anchored on the `.sub-heading`, not on the mark.** The mark sits at the end of the summary, so
  on a long summary it can be most of the way across the panel; a box anchored to it would open off
  the right edge. `.npt-tipped` makes the row the positioning context and the box opens at `left:0`
  with `max-width:100%`, so it cannot overflow whatever the summary does.
- **Opened by a JS-toggled class, not a `:hover ~` selector.** The two triggers are not in one
  predictable place — the mark is inside the `.sub-heading`, the name is an `<h3>` somewhere above
  it — so a sibling combinator would depend on exactly how Stash nests the pair. §5b is the record
  of what guessing at that markup costs; it is not worth guessing again for a hover. `tipTrigger`
  takes the *row* and looks the `.sub-heading` up per event, because an `<h3>` is Stash's element
  and outlives the re-renders that replace everything we inject, so a captured reference goes
  stale — and a `_nptTipWired` flag stops a fresh pair of listeners landing on it every rebuild.
- **`pointer-events:none` on the box is load-bearing.** Opened from the name, the box lands over the
  `<h3>`. A box that took the pointer would fire `mouseleave` on the name, close, hand the pointer
  back, and reopen — a flicker loop for as long as it was hovered. The cost is that the text cannot
  be selected, which is the normal trade for a tooltip.

If the injected stylesheet never lands, `display:none` never applies and the detail simply renders
inline after the mark — which is the pre-1.7.0 look, and the right way for this to fail.

Four rules hold it together:

- **The split rides on the blank line**, not on a delimiter of our own. A `||` marker would be
  visible as raw punctuation on the settings page any time this script does not run — a stale
  browser cache, or a `.js` never copied into the plugin folder, both of which have happened here.
  On `\n\n` the failure mode is Stash rendering the description exactly as it did before.
- **What goes in which half is a judgement, made per setting.** This is why the 17 splits are
  authored by hand rather than cut at the first sentence. The box opens on focus as well as hover,
  so it is better reachable than the `title` was — but it still does not exist on a touch device,
  and a screen reader has to reach a trigger to meet it.

  `a8`/`a9` are the live case. Their WARNING sentence was pinned to the *visible* half through
  1.7.4, on the §1/§5b reasoning that those two descriptions are the only warning auto mode gets.
  **At 1.7.5 the user asked for it in the tooltip** and it moved. The concern was put once and not
  repeated; what the test pins now is that the warning is intact and leads the tooltip, rather than
  that it is on the page. Mitigating it: since 1.7.4 the box opens from the whole description, not
  just the mark, so it is a large target rather than a small one.
- **A single-paragraph description is left alone.** Six of the seventeen have nothing worth hiding,
  and a mark that opens on hover to repeat the line under it is worse than no mark. Same rule as the
  tag recap's tooltips in §5.
- **The toggle is a `<button>`.** `SettingGroup`'s `onDivClick` walks up from the event target and
  returns early only for `a` and `button`, so a `<span>` would fold the whole group on click; the
  handler also calls `stopPropagation` in case that early return ever changes. A button is the
  keyboard-reachable choice too, which matters more here than for the tooltips — this is the half of
  the description with nowhere else to be read.

**Why the group description needs a toggle rather than a tooltip.** It is in the group *header*,
which is outside the `<Collapse>` — the same fact `readmeLinkSlot` relies on. So it is on screen at full height whether the group is expanded
or not, and **per-plugin collapse does not shorten it**; hiding paragraphs is the only thing that
does. Five paragraphs in a native `title` would also render badly and OS-dependently.

Both are re-applied on every tick and are idempotent, like everything else injected into this panel:
React drops them on re-render, and `tipSetting` returns early once the first child is `.npt-sum`,
`collapseDescription` once `#npt-desc-toggle` exists. A re-render therefore returns the description
to *collapsed* rather than to a half-state with no way out.

Stash has no default value for a plugin setting: an unset `BOOLEAN` reads as unchecked. Every
`enable*` type toggle is therefore **off on a fresh install**, and a run with none enabled must
say so in the dialog rather than silently doing nothing. That default is the right one here —
Prune deletes tag assignments, and opting in per type is how the user says which parts of the
library they have thought about. Do **not** invert the settings to make them default-on the way
`a2SaveTagsImmediately` is inverted in the sibling plugin; that trick is for a safe default, and
this one is not safe.

## 7. Answers to the questions this design was reviewed against

**Does Stash allow cycles in the tag hierarchy?** No. `pkg/tag/validate.go` calls
`ValidateHierarchyNew` / `ValidateHierarchyExisting` on every tag create and update, which reject
making a tag the parent of one of its own ancestors (`InvalidTagHierarchyError`). So a cycle
cannot be produced through the UI or the GraphQL API. Guard anyway, with a visited set in the
ancestor walk: the closure is memoized so the guard costs nothing, and the failure mode without
it is an infinite loop in the user's browser if a cycle ever arrives through a route that skips
validation (direct SQLite edits, a future import path). If a cycle *is* detected, log it as an
error and skip the tags involved rather than pruning them — under the plain rule every member of
a cycle implies every other, so all of them would be deleted.

**How can a one-pass computation depend on iteration order?** With the rule as specified it
cannot, and that is the point of stating it. Ancestry is a property of the tag graph, not of the
entity's tag set, so `implied` does not change as tags are removed — remove `A` first or `B`
first, the answer is the same. The order-dependence appears the moment the predicate is
re-evaluated against the *surviving* set instead of the original one ("remove `T` if some
**kept** tag has `T` as an ancestor"). In a chain `A → B → C` holding `{A, B, C}` both readings
agree on `{C}`; but in a cycle `A → B → A` holding `{A, B}`, the original-set rule deletes both,
while the surviving-set rule keeps whichever one the loop happened to visit second. That is the
whole of the difference — and it is another reason the cycle guard exists.

**What does `per_page: -1` mean?** Stash's `find*` queries paginate through
`filter: { page, per_page }`. `-1` is a sentinel for "ignore paging, return every match in one
response". Convenient, and dangerous on large types — see §5.

## 8. Interaction with the sibling plugin

`MergePerformerTagsToScenes` wraps `fetch` and reacts to our writes:

- **Auto Merge On Scene Updates** matches `/\bbulkSceneUpdate\b/` — every scene we touch gets its
  performers' tags merged back in, parents included.
- **Auto Merge On Performer Updates** matches `/\bbulkPerformerUpdate\b/` — every performer we
  touch has their tags pushed into *all* of their scenes.

Neither plugin is misbehaving; they simply disagree about direction. The fix is a cooperation
lease (see below) plus three fallbacks for when the lease is not honoured.

### The API this plugin publishes (3.2.0)

`coop().api.NormalizeParentTags` — one entry, `prepare(opts)`, plus a `version` number. It exists
because `TagBundleClipboard` offers Prune and Roll Up in its paste dialog, and until 0.5.0 it did
that by **copying this plugin's tag-exclusion rules** — `splitTerms`, `nameMatchesAny` and
`blockReason`, byte-for-byte, with a scan that named any `c`-prefixed setting key it did not
recognise so a newer version here could not drift past unnoticed.

**That scan working as designed is what retired the copy.** A plugin whose best answer to "are my
rules still yours?" is "here is a list of things I could not check" should stop guessing and ask.
The copy is gone and the caller now gets whatever this plugin's rules are on the day it runs.

Three properties, and each one is a decision:

- **`prepare` resolves to a bound planner, not an answer.** A caller drawing a list of tags
  re-plans on every tick as the user changes what is ticked, so the settings and the hierarchy are
  read once and `plan(...)` is **synchronous** from there. A checkbox that had to await a round trip
  would be worse than no feature. Both reads go through `autoSettings()`/`autoGraph()` — the auto
  mode's own caches — so a page where auto mode is already running pays nothing extra.
- **`autoMode` is a question, not a settings read.** It answers `'prune'`, `'rollup'` or `null` for
  a given entity type: what this plugin will do *by itself* the next time Stash saves one. Today
  that is `a8`/`a9` scoped by the type's `aN` toggle, with both-on collapsing to `null` (§5b's
  no-op). The day those nine settings become fourteen — a mode per type — every caller keeps
  working. A caller reading `a8` directly would break that day, and that is the entire argument for
  the API existing rather than the settings being documented.
- **One options object per call, always.** A field can be added without a new signature. Two are
  already there for that reason rather than for a caller today: `entityType` on both calls, and
  `plan({ typeFilter: true })`, which applies the per-type toggle to the plan as well. Nobody wants
  the second yet — a hand-picked tag list is not an entity update — and having it ready is what
  stops the day somebody does from being a breaking change.

**`version` is a floor for a log line, not a handshake.** Callers feature-detect the function they
want (`typeof api.prepare === 'function'`); the number is so a dialog can say *"the copy running
here is older than 3.2.0"* instead of *"something is missing"*.

**What it deliberately does not do: the entity-level exclusions.** `b1ExcludeEntityWithTagName` and
`b2ExcludeOrganized` need an entity, and a caller passes tag ids. Inventing an answer would be worse
than leaving the question with the one side that knows what it is looking at.

**`planTagSet` is the seam that made this cheap.** `planEntity` was split in two: the entity half
(Organized, the marker's primary tag, the exclusion tag) and the tag-set half, which is the whole of
the planning. The API calls the second directly. A second planner beside this one is exactly the
drift the API exists to end, so if this ever needs to diverge, do it inside `planTagSet` where both
callers see it.

### The bulk-edit lease

Both plugins live in the same browser tab and therefore share one `window`. That is enough for a
handshake: during phase 2 this plugin takes a **lease** that asks reactive plugins to stand down,
and `MergePerformerTagsToScenes` checks for one before auto-merging. The contract is written up in
the repo-root `CLAUDE.md` (§ Cross-plugin cooperation) because it is not ours alone; the parts
specific to this plugin:

- **Since 1.1.0 this plugin is on both sides of the protocol**, like the sibling and for the same
  reason: the roles are per *run*, not per plugin. The tasks are bulk; auto mode (§5b) is reactive.
  So it registers as a respecter at load and stands down for anyone else's lease before reacting —
  which is what makes the sibling's "will it stand down" warning, and ours, true in both directions.
  Registration is unconditional rather than gated on an auto mode being enabled: the flag means this
  copy honours the protocol, which is true whatever the settings say.
- **Auto mode honours our own lease no differently from anyone else's**, which sounds like a plugin
  standing itself down and is not. `guarded()` has already excluded every write we issue, so the
  only thing that can reach the check while our lease is held is a *user's* save in the same tab —
  precisely one that should wait for the bulk run to finish. The sibling's §7 documents the mirror
  image of this.
- The lease is taken **around phase 2 only**. Phase 1 writes nothing, so there is nothing to
  suppress, and holding a lease through a long scan would disable the sibling for no reason.
  Auto mode takes its own, much shorter one (§5b).
- Take it in a `try`/`finally` so a thrown error, a failed chunk or **Stop** cannot leave it
  latched. Leases also carry an expiry that is renewed per chunk, so a crashed tab releases it
  by itself.
- Renew per chunk rather than taking one long lease — a run over a big library can outlast any
  sane fixed expiry.
- The lease is **advisory**. Never assume anyone is listening: a sibling older than the protocol,
  or a third plugin nobody has heard of, will ignore it. Everything below still applies.
- What it suppresses is exactly the sibling reacting to *our* writes. Its own internal
  `_mergeDepth` re-entrancy guard is a different mechanism and is not touched.

**Server-side hooks are out of reach.** A plugin with `hooks:` in its YAML runs inside the Stash
server on `Scene.Update.Post` and friends. It never sees our `window`, so no lease can reach it.
If the user has one that touches tags, a run will fight it and the only remedies are disabling it
or a Rescan. Say so plainly rather than implying the lease covers everything.

Three things follow regardless.

**Performers run first** (§5). The performer pass is what triggers the wider, scene-fanning
merge, so it happens before the scene and image passes rather than after them. That does not
make the run self-correcting — see below — but it does mean the damage lands before the passes
that could report on it, rather than behind them.

**The plan is computed up front, so ordering alone cannot fix this.** Phase 1 finishes before
phase 2 writes anything, so tags the sibling adds to scenes *during* phase 2 were never in the
scene plan and will not be pruned by this run. **Rescan** is the answer, and this is the main
reason it exists.

**Detect it and say so.** The settings query is `{ configuration { plugins } }`, which returns
*every* plugin's settings in one response — we already pay for that. So at the start of a run,
read `plugins.MergePerformerTagsToScenes` out of the same response and, if either auto-merge flag
is on, check whether the installed copy registered itself as honouring leases:

- **Registered** — say so and move on: *"Merge Performer Tags To Scenes has auto-merge enabled;
  it will stand down while changes are applied."* No action needed from the user.
- **Not registered** (older than the protocol) — warn, naming the setting: the run will fight
  with it, and the user should either turn it off for the duration or plan on a Rescan.

Never toggle the sibling's settings from here. They are server-side configuration shared by every
tab and every user of that Stash, and a crash mid-run would leave them silently off — which is
exactly the failure mode the lease's expiry exists to avoid. Never block the run either: this is
the user's own pair of plugins, and the side effect is understandable once it is stated.

**Sibling side, done in 1.1.0.** `MergePerformerTagsToScenes` registers itself as a respecter at
load and checks `autoMergeSuppressed()` in each of its four auto-merge branches. The regex test
comes first in each condition (`/\bbulkSceneUpdate\b/.test(q) && !autoMergeSuppressed()`) so the
"standing down" console line is only emitted for a mutation it would actually have reacted to.
Manual button clicks are never suppressed — the user asked for those directly.

**The sibling is a bulk plugin too, since its 1.5.0.** Its library-wide task rewrites scenes across
the whole library and takes a lease while it does, so `begin()` reports one that is already held —
naming the owner and the task — the same way that dialog reports ours. It is a warning, not a
block: a task click is manual on both sides, and standing down for a lease we would only have taken
ourselves a moment later helps nobody. Ours is taken in `proceed()`, so nothing in `begin()` can be
looking at its own.

**A third plugin, `PropagateTagsAndPerformers`, now runs the same check against us** (1.7.6's
counterpart in that plugin, `checkHierarchySibling`), for the same reason: its eleven tag paths are
exactly as exposed to Prune/Roll Up as this plugin's merge is. `coop()` here gained a `declares`
field at the same version, purely for shape-consistency with the other plugins' shared object —
this plugin has no relationship-copy paths to publish into it, and nothing reads its absence as
anything other than "declares nothing." See "Cross-plugin cooperation: the `declares` registry" in
the repo-root CLAUDE.md for why that registry does *not* also carry this section's collision: it
answers "same path", not "hierarchy rewrite versus any addition," which is a different question with
no path id on either side.

## 9. Testing

Seven suites cover this plugin — `normalize-plan`, `normalize-apply`, `normalize-tasks`,
`normalize-tree`, `normalize-auto`, `normalize-modes`, `normalize-api` — plus
`coop` for the sibling's half of the lease. They run on `npt-harness.js`, which differs from the
sibling's harness in having a fake DOM real enough to build and read back a dialog, and which
starts runs by posting a `runPluginTask` mutation rather than by simulating a click. What they
cover:

- **Closure and pruning logic** — chains, diamonds (two parents), multi-root, the antichain
  result, and a planted cycle terminating with an error rather than hanging.
- **Marker handling** — primary tag implies but is never removed, and can be named as a reason.
- **The reason clause** — the lowest implying tag is named in both directions, incomparable
  candidates fall to the lowest id, and phase 2 keeps each entity's own reason even though
  entities are batched by shared delta.
- **Exclusion filters** — each of the seven, including add/remove asymmetry, `hasOwnProperty`
  vs prototype keys, and that a skipped tag does not block its own parents in Roll Up. For the
  name filters: several substrings each protecting on their own, padding and repeated whitespace
  yielding no empty term, and a blank setting protecting nothing rather than everything.
- **Two-phase dialog** — no mutation is issued before Proceed; Cancel issues none at all.
- **The modes** (`normalize-modes`) — the parser through the run it produces (singular, case,
  two-word Roll Up, arbitrary separators, unknown words ignored, last mention winning), the
  selectors seeded from the settings with Images off, one run pruning one type while rolling up
  another and writing both deltas, a selector change disabling Proceed and revealing Rescan, a
  Rescan not re-seeding the selectors, the keep-this-selection box storing and forgetting, a
  corrupt stored value reading as OFF, and the settings dialog's preview, Save, Cancel and Escape.
  Migration is covered where it is observable rather than in a unit test of its own: in
  `normalize-auto`, a pre-4.0.0 install still reacting and writing its migrated string back once;
  in `normalize-api`, a caller getting the same answers it always did; in `tagclip`, the sibling
  plugin not noticing that every setting key it depends on was renamed.
- **The hierarchy viewer** (`normalize-tree`) — that it issues no mutation and nothing beyond the
  settings and tag queries, that a diamond appears under both parents with exactly one of them the
  repeat, that cyclic tags are still reachable, that badges and the inspector name the filter
  actually configured, the footer holding four controls and no graph export,
  counts being fetched only on demand and pinned to `depth: 0`, the button then offering the
  re-fetch rather than reporting a status, and its tooltip saying what the query costs, and the filter box - matching
  case-insensitively anywhere in a name, with its clear icon appearing only while there is
  something to clear - and the find bar, which opens the path to a match, selects and centres it,
  counts and cycles through matches with Enter, and clears an active filter on the way. The jumps
  are covered against a tag with **three** parents, since two only proves a badge toggles: the `◆`
  badge walks them in order and wraps, the `↩` badge reaches the full copy, the inspector's tag
  lists jump, and jumping out of a flat filtered list restores the tree first. A failed tag query
  is covered too: both boxes and all five footer buttons are driven against a dialog that has no
  graph, and must stay inert rather than throw.
- **What a rescan keeps and what it resets** — the rendered log survives it, `--- Rescan ---`
  separating the passes and the lines above it still on screen; the log-line counter therefore
  describes the whole session and is pinned equal to what Copy log hands over; a rescan finding
  nothing keeps the lines behind it and still claims nothing hidden while it is under the cap; Copy
  log exports both passes; Rescan's own tooltip says the log is kept; and the sibling warning still
  clears when the setting it warns about is turned off.
- **The tag summary** — the exact closing line in both directions and both phases, the per-tag
  entity counts, an empty plan producing none, and a failed batch dropping its 100 entities out
  of the applied count rather than out of the plan's. Its tooltips too: the detail query scoped by
  id to the tags the recap names and asking for the two fields the hierarchy query does not, the
  tooltip's contents, a tag with neither field left plain, both phases' recaps hovering, the line's
  text unchanged so Copy log is unaffected, and a failed detail query leaving the line readable and
  unremarked. Ordering is covered against all three parts
  of Stash's rule at once (a `sort_name` override, case-insensitivity, and `Volume 2` before
  `Volume 10`), plus that the tag query actually requests `sort_name`.
- **Naming an untitled entity** — a zip gallery falls back to its file, a folder gallery to its
  folder, an image to its `visual_files` basename, and a real title still wins over all of them.
  The queries are asserted too: the fallback fields are useless if they are never requested, and
  that combination is exactly what shipped broken.
- **The id legend** — the run dialog's head says a bracketed number is an id and a count is
  written `x250`; the viewer's says the same for its rows, its name tooltip repeats it, and the
  inspector's headings are asserted to count *outside* brackets (`All descendants: 4`) since that is
  the rule the legend depends on. The tooltip's own content is covered too: the aliases and
  description it adds, both caps (eight names, then a counted tail; an excerpt cut on a word
  boundary), a tag with neither field saying nothing about them, and — in `normalize-plan` — a run
  *not* asking for either field. Auto mode's console legend is checked for being printed once,
  ahead of the first line it explains, and not repeated on the next reaction.
- **The settings-page description split** (`normalize-auto`) — the group description collapsing to
  one paragraph behind a toggle that is a `<button>`, expanding and collapsing with the caption
  following, the CSS actually hiding the rest, and no second toggle after a re-tick. Per setting:
  a two-paragraph description keeping only its first; the detail being an *element* rather than a
  native `title` (which cannot be positioned or sized), with no `title` left on the mark to double
  up with it, a focusable mark, and the row as the positioning context; hover *and* focus opening
  the box and closing it again; **the name and the summary opening the very same box** rather than a
  native title of its own, and the name not being wired a second time by a re-render;
  `pointer-events:none` pinned by name,
  since without it opening from the name flickers; further paragraphs staying paragraphs inside the
  box; a one-paragraph description left untouched, its name opening nothing; and — the check that
  matters — **the auto-mode WARNING intact and leading the tooltip, absent from the summary**. All
  twenty-five fail against 1.6.5.
- **The dialog chrome** (`style`, repo-level) — every CSS rule this dialog shares with the
  sibling's is compared against it and has to match. See the repo-root CLAUDE.md; this is the check
  that would have caught the modal being `#202b33` here and `#30404d` there.
- **No Clear log** — the run dialog does not offer one. Pinned so a reintroduction has to argue
  with §5 rather than slip back in.
- **Grouping and chunking** — identical deltas collapse into one mutation, chunks cap at 100 ids,
  a failed chunk is isolated and its entities are not logged as changed.
- **Task interception** — the click never reaches `runPluginTask`, and the fetch fallback catches
  it if the click handler is bypassed.
- **Processing order** — performers are queried and written before scenes and images, whichever
  order the settings come back in.
- **Sibling detection** — an auto-merge flag set on `MergePerformerTagsToScenes` in the shared
  `configuration { plugins }` response raises the dialog warning, and its absence does not.
- **Someone else's lease** — one held at `begin()` is warned about, names its owner and label in
  the head, and does not disable Proceed; no lease leaves the head empty.
- **Undo** — not offered before a write; one click arms with the scope in the caption and writes
  nothing; the reversal issues one mutation per applied batch, every one of them the inverse mode
  and a delta rather than a tag list; a failed batch is left out of both the armed count and the
  reversal; a lease is held across it and named `(undo)`; a rescan keeps it; and undoing from
  `ready` lands in `done` rather than back at Proceed. Roll Up is covered as well as Prune, since
  the inverse is read off what was written and not off the task.

- **Auto mode** (`normalize-auto`) — that a save triggers exactly one delta write in the configured
  direction; that an already-normalized entity costs a read and no write; every gate (both modes
  off, both modes on, a disabled entity type); that a bulk mutation is reacted to as one write
  covering only the entities that needed changing; that an auto write does not cascade; the
  cooldown, including that an entity we planned nothing for is *not* on it; standing down for a live
  lease but not an expired one; registering as a respecter; a lease held across the write and
  released after; a save Stash rejected not being reacted to; the exclusion filters still applying,
  including an unresolvable exclusion tag stopping auto mode outright; **the task's apply not being
  reacted to**, which is `_writeDepth`'s own test; and the tag-graph cache, fetched once and
  invalidated by a tag mutation.

  Every guard in §5b was confirmed against a deliberately broken copy before being trusted —
  `_writeDepth`, the task guard, the cooldown, the lease check, the both-modes rule and
  `mutationSucceeded` each have a mutant that fails exactly one check. That exercise is also what
  showed that the "does not cascade" check passes with `_writeDepth` removed, because the cooldown
  covers the same case; the check is named for the outcome it proves rather than the mechanism it
  does not, and the task-apply case is where the guard is isolated.

The suites cannot confirm Stash's own behaviour (page markup, `BulkUpdateIds` semantics), so any
change here still needs one run against a real instance — preferably a copy of the library. That
goes double for auto mode, whose whole surface is a `fetch` wrapper reacting to mutation names this
repo can only assert against its own fake Stash.

## 10. Versioning

Per the repo convention: bump the patch digit in **both** `NormalizeParentTags.yml` and
`manifest` on every change; bump the minor digit and reset the patch for a new feature.

**The dialog refuses to write with a stale script** (1.5.0). `checkVersion` asks Stash what version
of this plugin is installed (`query NPTPluginVersion { plugins { id version } }`) and compares it with `PLUGIN_VERSION`. On a
mismatch it warns in the head, naming both numbers and the fix, and **disables Proceed** until the
page is reloaded. Four things make that safe rather than obstructive:

- **Unknown is not a mismatch.** A Stash too old for the field, a plugin it cannot see, a failed
  request — all resolve to `null` and change nothing. The check exists to catch a stale script, not
  to make a run depend on one more query succeeding.
- **Only the two quiet outcomes go to the console**, beside the load banner. A matching version is
  the boring case, and a log line arriving whenever one small query resolves would land somewhere
  different every run — the dialog's log is about the library.
- **Undo is never gated on it.** It reverses writes this dialog already made; stranding the user
  with changes they cannot take back would be worse than the mismatch being guarded against.
- **It is the only warning here that blocks**, and the reason is worth keeping straight: every
  other one — the lease, the sibling's auto modes — is about the library or another plugin, where
  the user knows more than the dialog does. This one is about the dialog itself running code the
  user has already replaced, which is the one thing they cannot see. The hierarchy viewer runs the same
  check and *only* warns, because it writes nothing — see §5a.

It is not fired ahead of the scan but alongside it: one small query against a pass that reads the
whole library, landing long before Proceed is reachable, with `setState` re-applied when it does.
`begin()` calls it, so a rescan re-checks — the script cannot change without a page reload, but the
installed version can, and reloading plugins is exactly what the user does after seeing the warning.

**A plain F5 is normally enough** (measured 2026-08-06 against Stash 0.31.x): the browser
revalidates the plugin script on a normal reload, so the warning leads with F5 and keeps
Ctrl+Shift+R as the fallback. Do not talk the user straight into a hard refresh — the failure that
actually cost a session here was a `.js` that had never been copied into the plugin folder, where
no amount of refreshing helps and only the version line tells you so.

**What it cannot catch:** an edit with no version bump. Both numbers stay equal and the check is
blind, which is the practical argument for bumping the patch digit on every change.

**The description is a link plus the text, in three files.** It leads with a README permalink
pinned to a **commit SHA**, not `main`, so a user reading it in Stash gets the documentation for
roughly the code they have rather than whatever `main` says today. A commit cannot contain its own
hash, so the SHA is the revision where the README last changed — update it whenever the README does,
not on every version bump. The same string lives in ``NormalizeParentTags.yml`` and in `manifest`'s
`metadata.description`; they must match, and both must stay **double-quoted**, because the text
contains `": "` and a plain YAML scalar cannot hold that (NormalizeParentTags's manifest was unparseable YAML
until 2026-08-06 for exactly this reason).

**`url:` is the only clickable link Stash offers here** (1.5.4 / 1.9.3). Read from Stash's own
source rather than guessed: `SettingsPluginsPanel.tsx` passes `subHeading: plugin.description` into
`Inputs.tsx`, which renders `<div className="sub-heading">{subHeading}</div>` — a React child, so
markup in a description is escaped and shows as literal `<a href=…>` text. There is no markdown
either. The manifest's `url` (`URL *string \`yaml:"url"\`` in `pkg/plugin/config.go`) is rendered
by `renderLink` as an `ExternalLink` button — a chain icon in the plugin's header row, beside
Enable/Disable. Icon only: it takes no anchor text, so the link cannot be labelled.

The description does **not** carry the URL. It did until 1.6.0/1.10.0, on the theory that the text
reached places the icon does not; in practice Stash renders it as plain text, so it was an
unclickable 90-character prefix in front of every word that mattered. The two links are `url:` and
the injected one, and they must stay identical — the `version` suite fails if they drift.

**The description is paragraphs, and it takes two tricks to show them.** Stash renders it as one
text node inside a `.sub-heading` that is `white-space: normal`, and a description cannot carry
markup, since Stash passes it to React as a child. So the plugin marks its own settings group with
`.npt-own-group` — in the tick that injects the README link, and on **every** tick, because React drops
anything we add whenever it re-renders the panel.

- **`white-space: pre-wrap`, scoped to that class**, makes the newlines visible at all. Scoped, never
  applied to `.sub-heading` at large: another plugin's description is not ours to reflow, and may
  well have been written for the collapse.
- **The paragraphs are then rebuilt as `.npt-p` divs**, because a blank line under `pre-wrap` is always
  one whole line-height and nothing in CSS can target it. Splitting on blank lines drops them and
  the gap becomes `margin: 0 0 .35em` — about a third of a line. `splitDescription` is idempotent
  (once the children are ours there is no text node left to split) and re-runs after a re-render
  puts the text node back.

The two together mean the text degrades sensibly: if only the CSS applies, the paragraphs show with
full blank lines between them; if neither does, it collapses into prose that still reads, because
every line break falls at the end of a sentence. It is stored as a double-quoted one-liner with
`\n` escapes rather than a YAML block scalar, so the file stays greppable line by line and
`version.test.js` can keep reading it with a regex.

**Both point at `/blob/main/`, not a SHA** (1.6.2 / 1.10.2). A pinned revision was the first
instinct and it was tried: it means the link shows the documentation for roughly the code the user
has, rather than whatever `main` says today. Two things killed it. A SHA has to be **pushed** before
GitHub can resolve it, and pinning to a commit that was still sitting on a local branch shipped a
404 twice. And it has to be re-pinned every time a README changes, which is a step nothing enforces
and everything forgets — a link that silently rots into old documentation is worse than one that
tracks the branch. `main` is always current and always resolves; the cost is that a user on an old
version reads the newest docs, which the version line in the console at least lets them notice.

**And a labelled link of our own** (1.6.0). The chain icon is easy to miss, so the plugin injects
`<a>NormalizeParentTags/README.md</a>` into its own settings group, under the description. The
constraints that led here are worth keeping, because they close off the cheaper-looking routes:
Stash renders the description as a React child, so markup in it is escaped; CSS `content` cannot
carry an `href` and is not even copyable in Chrome; and there is no markdown anywhere in that panel.
JS is the only way to get link text.

Three details it depends on:

- **The group is found by the `plugin-<id>-<setting>` element ids**, never by heading text — the
  rule §2 of `NormalizeParentTags`' CLAUDE.md exists for, having shipped broken twice on headings.
- **It is re-added, not tracked.** React re-renders the panel on every settings change and drops
  anything injected into it, so the tick puts it back; the id keeps that from producing a second
  one.
- **Clicking it does not fold the group**, because `SettingGroup`'s `onDivClick` walks up from the
  event target and returns early for `a` and `button`. Read that before moving the link anywhere.

`README_URL` in the script, `url:` in the yml and the URL at the head of the description are the
same pinned revision, and the `version` suite fails if they drift apart.

**Three places, not two, since 1.4.4.** `PLUGIN_VERSION` at the top of the script is the third,
and it is the only one that says anything about the code actually running: the yml and the manifest
are read by Stash over GraphQL and go current the moment plugins are reloaded, while the browser may
still be executing a script it cached before the edit. The constant is printed to the console at
load, so "which version am I running" has an answer that a stale script cannot fake — a heading
reading 1.4.4 over older behaviour is the normal look of a cached script, not a contradiction.
`tests/version.test.js` loads the plugin and fails if the printed version and the manifest disagree,
which is what stops the third place from drifting.

