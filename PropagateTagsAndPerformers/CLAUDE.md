# CLAUDE.md — ᝯㄝₓ Propagate Tags and Performers to Related Entities

Project-specific guidance for this plugin. The repo-wide conventions (ES5 IIFE, no build step,
`gqlRequest`, the bulk-edit lease, the shared dialog chrome) are in `../CLAUDE.md` and still apply.
The user-facing description is `README.md`; this file is for the reasoning that does not belong in
either.

**Status: released, 3.6.0.** Every step in the table below has landed, so the version left the
0.x range: the major digit was always the claim that the plugin is finished and worth installing,
and it now makes it. From here a fix takes the patch digit and a feature the minor, like its two
siblings.

**3.5.0 lays the paths out the way the user reads them, and stops the dialog lying about a path
that is already happening.**

**`PATH_COLUMNS` is presentation and nothing else.** Three explicit lists of path ids - the
grouping is the user's, revised once at 3.6.0 - used by the dialog's columns and by the settings
row's listing, so a path is in the same place wherever it is shown. A `null` entry (3.6.0) is a
blank row separating two groups within one column, and it exists only where rows are drawn:
`displayPaths` drops it, because the settings row lists the paths that are *on*, where a gap
between two groups that may both be absent would be a blank line with nothing either side. `PATHS` is still the order a run walks, the order `formatPaths` writes, and the order
the dialog's head says decides what one run reaches. The risk of a second list of the same thirteen
things is a path missing from one of them - which would be a path with no control at all - so
`propagate-paths` pins the two against each other rather than trusting the two to be edited
together.

**A path can be running without being on, and showing it as Off was untrue.** `tags:studio>group`
plus `tags:group>scene` puts a studio's tags on its groups and then on those groups' scenes, which
is what `tags:studio>scene` does. `pathChains` composes the enabled paths **in pipeline order** -
the same cascade `plannedFor` performs - so a chain is only claimed when each link comes after the
one feeding it. A chain the other way round does land, one run later, and is deliberately not
claimed: the button describes one run.

- **Only `on` links count, never `common`.** A link carrying just the tags all its sources share
  carries part of the payload, so calling the path covered would overstate what the user gets. It is
  testable, which is worth knowing: `tags:performer>scene` + `tags:scene>group` covers
  `tags:performer>group`, and turning the second to Common tags only takes the claim back.
- **It returns the witness chain, not a flag.** A tooltip naming the two paths doing the work is the
  difference between a state the user can act on and a state they have to reverse-engineer.
- **The look is the resting background with amber letters**, never a filled amber button: nothing
  was switched on, and switching it on is a *different* thing - it adds the direct copy, which
  reaches scenes with no group at all. Save still writes only what is actually set.
- **Every press repaints every button**, because a press can complete a chain covering some other
  path, and leaving that one showing Off is the same lie in a different place. `repaint` computes
  the chains once and hands them to thirteen paints; thirteen buttons each deriving their own answer
  is thirteen chances to derive it from a half-updated map.
- **The caption alone no longer identifies the state**, which is the cost. A covered button says On
  while its mode is Off, so the colours are what distinguish them - and a test helper that pressed
  until the caption matched had to become a single click.

**3.4.0 moves the bulk buttons into the footer and gives every control in the dialog a tooltip.**
The buttons sit at the far end of the footer from Save and Cancel, pushed there by their own row's
`margin-left:auto` - the shared `.foot` rule is one of the pinned ones and is untouched. They set
what Save then stores, so the footer is where they belong; over the columns they read as a second
header. `All On / Common Tags` gained the *Only* the two path buttons already say, because the
shortened caption was the one place in the dialog where "common tags" could be read as "and no
others".

**The path tooltips are generated from `PATHS`, not written out thirteen times.** `pathTip` reads
the same fields the planner walks - `kind`, `target`, `source`, `hops`, `common`, `pair` - so a row
re-routed in that table cannot leave a tooltip describing what it used to do. It is also the only
place two facts are stated per path: what the third mode means for the two that have one, and that a
path has a reverse in the table, which run together drive both sides to one set of tags. The dialog's
head says the second generically for whatever pair is on; the tooltip says which path it is.

**3.3.0 pulls the two moded paths into a column of their own and adds three bulk buttons.** Both
came from live use of 3.2.0 and both are about the same thing - a `max-content` grid column resizes
to whatever its widest button currently says, so pressing one of the two paths that cycle through
*Off / All tags / Common tags only* moved the column, and with it every label beside it. They are the
only two buttons here whose caption changes width, so they now share the third column and carry
`.ptp2re-toggle-wide`, a `min-width` floor sized for the longest of their three captions. **A floor,
not a fixed width**: it can only stop a button shrinking, so a theme with a wider font grows the
button rather than clipping the caption.

**Pipeline order still reads down each column, and that is the whole of what the order promises.**
Pulling two paths out of the sequence is a smaller cost than it looks: the dialog's head states the
order matters, and it still holds *within* a column - what the third column loses is its position
relative to the other eleven, which is a claim nobody reads off two columns either.

**"All On / Common Tags" is not a fourteenth state.** `setAll(mode)` gives each path the mode if
`pathStates(p)` has it and plain On otherwise, so one function covers all three buttons and a path
that grows a mode later is covered without an edit. All Off is grey and the two All On buttons are
amber, matching the per-path buttons below them rather than the footer's rule - they set the same
states those buttons set.

**3.2.0 makes each path's control a button that carries its own state.** A `<select>` costs two
clicks for every change - one to open the list, one to pick - so thirteen of them is twenty-six
clicks to set a library up, for a control whose choice is two thirds of the time just Off and On.
The button shows the state and takes the next one on a press.

**There is no tri-state button in HTML, so the two "common tags only" paths cycle.** Off → All tags
→ Common tags only → Off, one press each, with the cycle named in the title - which is the job the
select's open list was doing for discoverability. It is never worse than what it replaces: that
select cost two clicks for *every* change, and this costs one for the common case and at most two
for the rest.

**The alternative was a segmented group of three, and it was not taken.** One click to *any* state
and self-documenting, which is genuinely better on those two rows - and it is a second widget shape
in a column of thirteen, three times the markup for two of them, and it widens the column for the
other eleven with it. If a third path ever grows a mode, revisit it.

**A checkbox's `indeterminate` is the other thing called tri-state and is not one:** a user cannot
set it, only script can, and its third state means "unknown" rather than a third choice.

**Bootstrap variants rather than a stylesheet of our own**, so hover, focus and active come from
Stash's theme - and `btn-warning` is the repo's "this plugin writes" amber, which is exactly what a
path being on means. Off is `btn-secondary`; both on-states are amber, and which of the two an amber
button is in is what its caption says. The only rule left is
`.ptp2re-toggle{justify-self:stretch}`, so thirteen captions of five different widths do not leave a
ragged column - the grid column is already `max-content`, and stretching each button across it lines
their edges up. `.ptp2re-mode`/`.ptp2re-mode-on` went with the selects; `NormalizeParentTags` and
`TagBundleClipboard` still share them, so the CSS suite still compares those two.

**3.1.2 is the actual cause of the lost settings, and 3.1.1 was not it.** `configurePlugin`
**replaces** `plugins.<id>` rather than merging into it, so every partial write this plugin made
deleted every other setting the user had. The user's `config.yml` settled it in one paste: it held
exactly the two keys the 3.1.0 exclusion import had named, and nothing else - no `b1Paths`, no
`a1ShowManualButtons`, none of the legacy path booleans. The 3.0.0 migration had wiped the map once
by writing `b1Paths` alone, and the import wiped what was left. Every write now goes through
`writeOwnSettings`, which reads the stored map, patches a copy and sends the whole thing.

**The rule is in the repo-root CLAUDE.md now, with the Stash source that settles it**, because it
had been in `CustomFieldsBulkEditor`'s `followHideRename` comment since its 2.0.1 while two plugins
copied the broken shape. A fact about Stash's API in one plugin's comment is a fact the next plugin
will not have.

**3.1.1 stops the settings row deleting a value it could not read.** Still worth having, and it is
where this investigation started - but it was the wrong suspect: a value written by 3.0.x parses
cleanly, and the paths were never unreadable. They were gone. Reported live as "I lost my
path settings". `pathFieldTick` rewrites a hand-typed value in canonical form - the convenience
copied from `NormalizeParentTags` - and canonical form is *whatever `parsePaths` understood*. Run
over a value this copy only half reads, that is a rewrite that deletes the other half; run over one
it cannot read at all, it writes an **empty string**, and the setting is gone with no way back and
nothing said.

**The sibling cannot have this bug, which is why the copy did not inherit its safety.**
`formatAutoModes` always emits seven pairs, so its canonical form is never empty and never shorter
than what it read. `formatPaths` emits only the enabled paths, which was the right call for
thirteen - and it is exactly what makes an unreadable value formattable as nothing. **A rule copied
from a sibling carries the sibling's preconditions, and this one changed them in the same release
it copied it.**

- **Two guards, and the second is the one that matters more.** Empty canon is the catastrophic case;
  `unrecognisedPairs(raw) > 0` is the quiet one - twelve paths this release knows and one a newer
  release added would have been rewritten to twelve, which is data loss that looks like a working
  plugin.
- **It counts pairs *applied*, not pairs matched.** `tags:everything>everywhere=ON` satisfies
  `PATH_PAIR` and is then dropped by `pathById`, so counting matches called that value fully
  understood and deleted it on the next tick. The first version of the guard did exactly that and
  the fixture caught it.
- **The row distinguishes "nothing enabled" from "I could not read this".** They look identical
  from the paths alone and are not the same thing: the first is a choice, the second is a value
  still sitting in the config that this script is declining to touch. Saying the first over the
  second is what makes the loss look deliberate. A *partly* read value gets both - the paths in
  force, and a line saying the rest is not - which is why the three-column grid moved onto an inner
  `.ptp2re-pathstring-list`, so the warning can sit beside it rather than in a cell of it.
- **The dialog says it too**, because Save rewrites the whole setting from its selectors and so
  *will* drop what could not be read. That is fair on a press and not fair in silence.

**What this does not explain is how the value became unreadable in the first place**, and that is
still open: a value written by 3.0.x parses cleanly here. The fix is right either way - it is the
difference between a bad value and a lost one - but if it happens again the console line now names
the string, which is the thing nobody had.

**3.1.0 adopts `MergePerformerTagsToScenes`' four exclusion filters where this plugin has none of
its own.** They are the same four questions worded for a wider set of entities -
`ExcludeTagWithIgnoreAutoTag` is the same words in both, and the repo's settings convention is that
only the letter differs - so somebody running both has answered them once already, and answering
them again in the same words is the setup step that gets half done.

- **"Never set" is the key's presence in the stored config, not its value.** A BOOLEAN turned on
  and off again is `false`, which is also its default; comparing values would re-adopt it on every
  page load, and a setting that comes back after you switch it off is worse than one you have to set
  twice. `configurePlugin` stores what it is sent, so the key exists from the first time the user
  touches the row. This is the one assumption here that would be wrong if Stash ever stripped
  default-valued keys from a plugin's config map, and it is the reason the rule is stated in the
  four descriptions in terms of *touching* the setting rather than of what it says.
- **A sibling value equal to our own default is not an import.** Writing it would set the key and
  so spend the one chance this has to run, on a value that changes nothing.
- **Written back, not held in memory.** An import nobody can see is a settings page reading "no
  exclusions" over runs that exclude. Writing makes the value ours, editable, and - because the key
  now exists - never adopted again. `_importedExclusions` keeps it to one mutation per page, the
  same latch `migrateLegacyPaths` uses.
- **A name lookup, unlike the `declares` overlap check beside it**, and `MPTTS_ID`/`MPTTS_NAME` are
  new constants for it. Two plugins having the same *settings shape* is not a capability either of
  them publishes, so there is nothing generic to key this on - the same argument §5a already makes
  for `checkHierarchySibling` being name-based while the path overlap is not.
- **One-directional.** `MergePerformerTagsToScenes` is untouched: it asked first, and a plugin that
  reached back into the answer it gave would leave neither settings page trustworthy.

**3.0.2 puts the settings row's listing in three columns.** Thirteen stacked entries was a column
of text taller than every other row on that page put together. Three columns cost nothing in width
*because* the two entries carrying a mode are grouped last: `(Common tags only)` makes them half as
long again as the rest, each column is sized to its own content (`max-content`, not equal columns,
or the longest entry would set all three), so letting the pair share the last column keeps the other
two narrow. Scattered through pipeline order they would have widened two columns instead of one.

**Reordering is fine here and would not be in the dialog.** This row lists *which* paths are on; the
dialog is where the walk order is shown and stated to matter. The row count is set from JS
(`grid-auto-flow: column` over `grid-template-rows`), because the stylesheet cannot know how many
paths are enabled - and it is cleared again for the "No paths enabled" sentence, which would
otherwise sit in a column of its own with two empty ones beside it.

**3.0.1 is the path dialog's layout, from a live screenshot.** Three faults in one picture, and
the third is the one no test would have found:

- **`1fr auto` stranded every select at the far edge of a 100rem modal.** A flexing label column
  takes the whole panel, so the thing a label names ends up an arm's length from it. Both columns
  are `max-content` now, which is what "line the selects up" actually needs.
- **The modal is `.ptp2re-narrow`**, a plugin-local modifier beside the pinned shared `.modal`
  rule - the pattern `CustomFieldsBulkEditor`'s `.cfbe-tall` set. The shared `min(100rem,94vw)` is
  sized for log lines naming an entity, an id and two values; two columns of short labels want
  less, and widening past what they need only pushes each select further from its label.
- **The "Into &lt;plural&gt;" headings were wrong, not merely redundant.** Pipeline order visits a
  target, leaves it and comes back - `tags:image>gallery` sits between the scene paths and the
  group paths - so a heading emitted at a target's *first* path collects every later path of that
  target under whichever heading happened to precede it. The screenshot showed
  `Tags: Images → Galleries` under **Into Scenes**. The labels already name the target and the
  order is what the grouping would have had to break, so the headings are gone rather than fixed.
  A fixture proving the order is preserved cannot see this: the order *was* preserved, and the
  heading above it was the lie.

Two columns, filled top to bottom, seven and six, so reading down one and then the other is still
the order a run walks them in.

**3.0.0 replaces the fifteen path settings with one string and a dialog**, the move
`NormalizeParentTags` made at its 4.0.0 and for the same reason. Thirteen path toggles spread over
four alphabetical blocks, plus two "common tags only" modifiers whose pairing with a path could only
be inferred from the wording of their names, are now `b1Paths` — one line of `<path id>=<mode>`
pairs — and a **Path Settings...** task that is the editor for it.

- **The token is the path id.** `tags:performer>scene`, the string `coop().declares` already
  publishes and every table here is keyed by, rather than a second vocabulary invented for the
  setting. A path renamed in one is renamed in the other, which is the coupling wanted.
- **A path is Off, On, or - for the two carrying `common` - Common.** That is a tri-state, and a
  Stash plugin setting is BOOLEAN, NUMBER or STRING with no tri-state and no repeated group. The
  modifier being a *mode of its path* rather than a second row beside it is the readability half of
  the change; the type system is the half that made a string unavoidable.
- **`PATHS` no longer carries `setting` or `mode`.** `pathMode(s, path)` / `pathOn` / `pathCommon`
  are what the eight former `s[p.setting]` / `s[p.mode]` reads ask, so a repartitioning of the
  setting costs one function rather than a search for every boolean read. §4's note that `PATHS` is
  "a second place the manifest keys live" is retired with them: there are no per-path keys left to
  drift from the manifest.
- **Only the enabled paths are written back**, in pipeline order. This is where it departs from the
  sibling, which writes all seven of its pairs including the OFFs: thirteen `=OFF` entries would
  bury the two that matter, and an absent path already means off.
- **Migration is exact and silent.** `settingsFrom` maps the fifteen old keys when `b1Paths` is
  empty and at least one of them is set, and writes the result back so the settings page shows it.
  Renaming a key orphans what the user had; this is the one thing that stops the replacement from
  being a reset.
- **The row is taken over, not hidden.** Stash renders a STRING setting as a value span and an Edit
  button opening a one-line text modal, which for thirteen pairs is a place to make a typo in.
  `pathFieldTick` replaces the value with the enabled paths in words and the button with one opening
  the dialog, hiding Stash's own rather than removing them - React owns those and the setting must
  stay editable if this script ever stops running.
- **`host` is the row itself where there is no `.value`, never `row.childNodes[0]`.** The sibling's
  copy reads the first child, which on the second tick is the line the first tick appended - a
  HierarchyRequestError in a browser and a silent unlink in the harness. It is unreachable while
  Stash renders a `.value` span, which is why nobody has seen it; the same line in
  `NormalizeParentTags`' `modeFieldTick` still has it.
- **Major, and it is the settings page that earns it**, not a rename: fifteen keys stop existing.
  No README release-note block, by the repo rule that such a block is for something a user has to
  *act* on - the migration carries their configuration across, and the new shape is described in
  the prose where someone reading about paths is already looking.

**2.1.0 is the busy cursor.** `▙ ▛ ▜ ▟` under the last log line, one cycle at 2Hz, while the run
dialog is scanning, applying or undoing. The sweep is the case that wanted it: reading every image
in the library to find each gallery's leaves the counters still for a long time, and a progress line
that has not moved reads as a hung tab. `spin(busy)` hangs off `setState` and nothing else; `flush()`
lifts the cursor out before appending and puts it back at the end; `close()` clears the interval for
a dialog dismissed mid-write. It is `.ptp2re-spin`, never `.ptp2re-line`, so neither the render cap
nor a check reading log lines back sees it. Shared design, in the repo-root CLAUDE.md; all four
plugins took it in one release.

**2.0.0 is a rename, the second one, and the same kind of change as 1.0.0.** The `GTTx ` prefix is
now `ᝯㄝₓ `, in the `.yml`, the `manifest`, `PLUGIN_NAME`, `PLUGIN_SHORT_NAME` (`ᝯㄝₓ Propagate Tags
& Performers`, what the dialog heads wear), `NPT_NAME` and every fixture in `tests/` that mounts a
settings or tasks heading. The folder, the plugin **id**, every setting key, every path id in
`declares` and every storage slot are untouched, so an upgrade keeps its configuration; the major
digit is for the heading matches — `ownSettingGroup`'s fallback, `headingIsOurs`, `ownTaskName` —
now comparing against a different string.

**The rename landed in the `.yml` a release before the `.js`, which is worth recording because the
four plugins fail differently under exactly that.** Here the settings group was still found (the
`plugin-<id>-<key>` ids Stash builds from the plugin **id** are the primary route, heading text only
the fallback) while the task button stopped being recognised, since `ownTaskName` has nothing but
the heading. `CustomFieldsBulkEditor`, whose only route in *is* the heading, lost its settings panel
outright and gave no sign of it. **A name lives in two files, and the page that still looks right is
not evidence the other one moved.**

**1.4.1 takes the release notes out of the README.** The standing rule is new and lives in the
repo-root CLAUDE.md ("A README describes the plugin, not its history"): a block at the top of a
README is for a **major** version only - a rename, a settings reset, something a user already
running the plugin has to act on - and everything else belongs in the prose that describes the
behaviour, in the present tense. This plugin had the most to lose and lost it: the 1.0.0 block, two headings' version parentheticals, and **eleven** mid-sentence references - "since 0.13.0", "up to 0.12.14 the answer was computed and thrown away", "(0.18.1)" - a changelog scattered one parenthesis at a time through an explanation of how the plugin behaves now. The two that stayed are requirements rather than history: Stash 0.31.0, and `MergePerformerTagsToScenes` 1.12.1 for the button dedup. Nothing was lost: each removed note had a section that
already covered its area, which is the test of whether the note was needed at all. The per-version
reasoning stays here, in a file that does not ship.

**1.4.0 puts the same warning in the dialogs.** The version check was always there and always
blocked Proceed; what changed is that its message is a box of its own (`.ptp2re-stale`, the settings
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

**1.3.0 tells the user the script is stale, where they can see it.** Stash serves plugin JS with
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

**1.2.2 fixes a clause 1.2.1 left dangling.** Stripping "Since 0.16.0" from the cache-refresh
paragraph left "before that only the source-side button refreshed" pointing at nothing. The lesson
is small and general: removing a version stamp is not always a deletion of one phrase, since the
sentence after it may be leaning on the version for its antecedent.

**1.2.1 is a README pass.** The reference sections had accumulated version archaeology - "Since
1.13.0 the two plugins agree...", "0.9.1 supplied that gap with a margin, which turned out to..." -
which is a changelog written into the middle of an explanation of how the plugin behaves *now*. The
release-note blocks at the top of the README are the place for that, and they still have it; the
rest reads in the present tense. Nothing in the script changed but the version constant.

**1.2.0 keeps the log until the dialog closes, and gives Rescan a tooltip.** `rescan()` no longer
empties the rendered log — it writes `--- Rescan ---` and the next pass carries on below it, which is
what `CustomFieldsBulkEditor` has always done and what the user asked the other three to match. The
consequence is a **deletion**: `viewLines` existed only because a rescan emptied the view under the
counter, so with the view session-scoped it is exactly `lines.length` and is gone (§5's "two
counters, deliberately" is now one). All three siblings changed together, along with the shared
footer order: `CustomFieldsBulkEditor` moved Apply to the leading position this dialog gives
Proceed, so all four footers now read the same way round.

**1.1.2 says "id", not "Stash id", and never "(s)".** Two repo-wide wording rules landed together, and
both are in the root `CLAUDE.md`. *Stash ID* is already Stash's own name for a **stash-box**
identifier, so calling the local database id one was a claim about a metadata provider that had
never been consulted - every dialog head, legend and README here now says **id**. And every
generated `3 scene(s)` / `2 child(ren)` now agrees with its own count, through one
`plural(n, one, many)` helper held byte-identical in all four plugins beside `coopObject`.

**1.1.1 trims one word from the head.** "only while it stays open" is now "while it stays open" - the load-bearing "only" is the one in "reverses only what this dialog wrote", and a second in the same clause read as emphasis rather than a limit. All three dialogs were reworded together at the user's wording; `CustomFieldsBulkEditor` 0.4.1 carries the same sentence.

**1.1.0 adds Escape to the dialogs.** Every dialog here now closes on Escape, through whichever of Cancel/Close its footer is showing rather than around the footer - so the key does nothing mid-write, where both are hidden and Stop is the only way out. The head's backup line was reworded to "Backing up your database before proceeding is recommended." at the same version, in all four plugins; the sentence stating what Undo cannot reach is unchanged. 1.1.0 also folds the reversible-pair warning into one note however many pairs are enabled - with both pairs on it printed the same three sentences twice.

**1.0.1 is two README lines.** A fourth plugin, `GTTx Custom Fields Bulk Editor`, joined the repo: the debug switch is no longer shared with one sibling but with every plugin here that draws a control into Stash's UI, and "Relationship to the other plugins in this repo" was listing two of three. The README ships in `files:`, which is why a prose fix took a patch digit; nothing in the script changed but the constant.

**1.0.0 is also a rename.** The display name is now `GTTx Propagate Tags and Performers to Related
Entities`, in the `.yml`, the `manifest` and `PLUGIN_NAME`, and `PLUGIN_SHORT_NAME` with it —
`GTTx Propagate Tags & Performers`, which is what the dialog heads wear. The folder, the plugin
**id**, every setting key and every path id are unchanged, so an upgrade keeps its configuration
and the `declares` registry still matches across versions. See "Cross-plugin cooperation: one name
prefix" in the repo-root `CLAUDE.md`.

| Step | | Version |
| --- | --- | --- |
| 1 | Scaffold: manifest, settings, `TARGETS`/`PATHS`, CSS | 0.0.1 |
| 2 | Shared base: cooperation, GraphQL, task interception, dialog, settings page | 0.1.0 |
| 3 | The planner — all eleven walk-based paths | **0.2.0** |
| 4 | Phase 2 apply, and Undo | **0.3.0** |
| | — the log names the source entity, not the path | **0.3.1** |
| 5 | The two reverse-query paths (a gallery's images) | **0.4.0** |
| 6 | Auto mode, target side, **and** the per-entity cooldown | **0.5.0** |
| | — auto mode, source side (the fan-out) | **0.6.0** |
| 7 | The `declares` registry, **and** NormalizeParentTags awareness | **0.7.0** |
| 8 | Manual buttons and staging | **0.8.0**, fixed at 0.8.1, 0.8.2 and 0.8.3 |
| | — button size and enabling-logic fixes, source-side buttons, the naming convention | **0.9.0** |
| | — placement (before Save/Delete, not after) and wrapped-row spacing | **0.9.1** |
| | — wrapped-row spacing redone as `row-gap`: 0.9.1's `my-1` grew Stash's own buttons | **0.9.2** |
| | — deterministic ordering against `MergePerformerTagsToScenes`' buttons (`coop().order`) | **0.10.0** |
| | — target-side placement moved from before Save to between Save and Delete | **0.11.0** |
| | — the anchor is Delete-or-Save now, so a Delete-less page no longer displaces Save | **0.12.0** |
| | — Delete is also found by text: the `.delete` class does not exist on Scene's row | **0.12.1** |
| | — the source button's blink loop: it saw its own label as a foreign button's | **0.12.2** |
| | — row and column spacing measured off the row itself, per container kind | **0.12.3** |
| | — the measured margins now win the cascade; `mx-1` is a fallback, not a default | **0.12.4** |
| | — gaps filled against the real neighbours, for rows Stash spaces unevenly | **0.12.5** |
| | — the gap measured off the page rather than derived (reverted at 0.12.7) | **0.12.6** |
| | — a wrapped neighbour read through to the action inside it | **0.12.7** |
| | — an *actionless* neighbour walked past entirely, to the button behind it | **0.12.8** |
| | — the apply/undo batch driver written once; `findByClass` → `querySelector` | **0.12.9** |
| | — README gains the per-page table of all 26 buttons, MPTTS's two included | **0.12.10** |
| | — the button existence probe: a cached tag context, and parallel source lookups | **0.12.11** |
| | — the rest of the button delay: settings served stale, the probe stopping at one page | **0.12.12** |
| | — the delay, measured: the tag query was 766 ms of it, so cache it long and warm it | **0.12.13** |
| | — and measured again: the probe starts from the route, not from the row appearing | **0.12.14** |
| | — Improvement 4: a button hides when a click would add nothing, and re-checks on save | **0.13.0** |
| | — `coop().debugButtons`: a console switch that says why each button is shown or hidden | **0.13.1** |
| | — that switch said nothing off a cached answer, which is when it is switched on | **0.13.2** |
| | — one of its lines named Scene on every page; and Scene/Gallery confirmed anchorless | **0.13.3** |
| | — a second anchor: our own row under the tab strip, for pages with no action row | **0.14.0** |
| | — that row shown only on its targets' tab; Apollo evicted so counts redraw; labels | **0.15.0** |
| | — parity with `MergePerformerTagsToScenes` on the one path both plugins run (§5f) | **0.16.0** |
| | — amber for "a plugin wrote this": every button and four settings toggles (§5g) | **0.17.0** |
| | — no unreviewed write: a saving button opens the dialog, scoped, and says so (§5h) | **0.18.0** |
| | — a scoped title says which entity, in a name the user recognises (§5h) | **0.18.1** |
| | — the `GTTx ` name prefix, and the version the whole table above was building to | **1.0.0** |
| 9 | Repo `CLAUDE.md` TODO/IDEAS | — |

**Placement and row spacing are one design in two copies**, shared with
`MergePerformerTagsToScenes` and written up in full in the repo-root CLAUDE.md ("Placing a manual
button near Stash's own actions" and "Cross-plugin cooperation: deterministic button ordering"). The
step table above is the record of how many releases it took; the rules themselves live there, and
§5b-§5d below map this plugin's own copy of the code. The four that cost the most:

- **`.edit-buttons` is `display: block`** (measured live), so `row-gap` is inert on it while the flex
  `.details-edit` honours it - same call, opposite result, decided entirely by the container. The
  block case gets a bottom margin on our own buttons instead.
- **Stash's own buttons there carry `margin: 0 10px 0 0`**, a value no utility class in either plugin
  can name (at a 14px root, `mx-1` is 3.5px and `mx-2` is 7px). So the row's step is read off a
  button Stash put there rather than chosen.
- **Bootstrap's spacing utilities are `!important`**, so a measured margin only reaches the page with
  the class off the button. One declaration landing and its neighbour not is a specificity problem,
  not a wrong value.
- **A margin is true whenever you ask; a `getBoundingClientRect` gap is true of one instant.** These
  rows are still settling when a button is inserted, and the DOM sibling beside a button is not
  always the action the user sees - resolve through a wrapper, and walk past an element holding no
  action at all rather than reading its absent margin as a zero gap.

**What is left there is taste, not a defect.** The edit rows sit at Stash's own 10px on every
boundary, which live feedback calls "a bit too large" - but tightening it means our buttons no longer
match the row they are in. That is a call for the user, not a bug to fix silently.

**The `.details-edit` fallback and the 0.8.x live findings are still load-bearing**, and §5b carries
them: `findManualButtonContainer` tries `.edit-buttons` first and falls back to whichever
`.details-edit` does *not* carry a Delete button; `childNodes` is a live `NodeList` with no
`Array.prototype` methods; every manual button carries `align-self: flex-start` to opt out of a flex
row's `align-items: stretch`; and the two-signal duplicate check (`otherPluginDeclaresPath` +
`foreignButtonAlreadyShows`) needs both to be true before a path drops out, because `declares` alone
is a capability rather than a fact about what is on screen.

**Steps 3 and 5 were re-cut during step 3.** The plan had two hops and the "common tags only" modes
as a step of their own, on the assumption that reaching a group's performers through its scenes
needed a query per group. It does not: GraphQL nests, so `Group.scenes { performers { tags } }` is
one query and a two-hop path is only a longer `walk`. The modes are a fold over the sources, equally
cheap. Splitting them out would have shipped a path whose "common tags only" setting was visible in
the UI and silently ignored, which is worse than either half. What genuinely differs is the two
paths out of a *gallery's images*, which have no field to walk and need a reverse query — so that is
step 5 now.

The full design, including the decisions that were taken and the paths that were rejected, is in
`.plans/propagate-tags-and-performers.md`, tracked in git alongside the rest of this plugin.

---

## 1. What it does, and the one word that matters

Tags and performers are copied **along Stash's entity relationships**: a scene's performers' tags
onto the scene, a gallery's images' performers onto the gallery, a group's scenes' tags onto the
group. Thirteen paths, each its own setting, all off on a fresh install.

It is a **copy, never a move**. Nothing is removed from the source, and nothing is removed from the
target either. The single exception is the dialog's Undo, which removes what that same dialog just
added — and every other decision in here assumes the additive rule, because a wrong copy cannot be
taken back by the thing that made it.

`MergePerformerTagsToScenes` implements one of the thirteen (`tags:performer>scene`). Both plugins
stay installable and both keep working with both enabled; the overlap is redundant work, never
wrong data, because both only ever add. Announced rather than prevented — see step 7.

## 2. The path table is the spine

`PATHS` in the JS is read by the task, both automatic modes, the manual buttons and the
cross-plugin declaration. Nothing else carries a list of what this plugin can do.

**Array order is the pipeline order, and it is semantics.** Paths cascade: running markers into
scenes before scenes into groups means the group transitively inherits marker tags, and the reverse
order does not. Six stages:

1. **Performer assignments** — images → galleries, galleries → scenes.
2. Tags onto scenes — markers, performers, studio.
3. Tags onto galleries — images.
4. Tags onto groups — scenes, studio, and through those scenes the performers and markers.
5. Sub-groups → containing groups.
6. The two reverses — groups → scenes, galleries → images.

**Stage 1 exists because the design got it wrong first.** The plan put the performer assignments in
stage 2, after the tag paths. That silently defers work by a whole run: `tags:performer>scene`
copies a scene's performers' tags onto the scene, and `performers:gallery>scene` gives the scene new
performers, so a performer arriving after the tag path has run brings no tags with it until the next
pass. Nothing errors, so nobody finds out. Anything that *assigns* has to land before anything that
*reads* the assignment.

**Never derive the order from the settings object's key order.** It is not guaranteed, and it would
put the reverses in the middle.

Two fields describe the traversal and only one of them is stored. `walk` is the list of field names
from the target down to whatever carries the payload, and `pathSelection()` builds the GraphQL
selection from it — because a `walk` and a hand-written `select` beside it are two things that can
disagree. Three shapes the builder has to get right:

- **A marker's primary tag counts.** `SceneMarker.primary_tag` is a required field of its own, and a
  marker whose primary tag is `Blonde` carries that tag as much as one that lists it. `markerTags`
  is what adds it to the selection.
- **`Scene.groups` and `Group.sub_groups` are not Groups.** They are `[SceneGroup!]` and
  `[GroupDescription!]`, each wrapping a Group in a `group` field, so both walks carry an explicit
  `group` step. Walking straight to `tags` asks for a field the type does not have.
- **A Gallery has no `images` field.** Only `image_count` and `image(index)`. So both paths out of a
  gallery's images use `reverse` — a `findImages` query with a gallery filter — rather than a walk.
  These are the only two paths reached that way.

**`Group` has no `performers` field, in any direction.** So no performer path can reach a group, and
`tags:performer>group` has to route through the group's scenes — which is what makes it two hops.
This is a schema fact, not a scoping decision; do not let anyone "add the missing path".

## 3. The two reversible pairs

```
tags:scene>group   ⇄  tags:group>scene
tags:image>gallery ⇄  tags:gallery>image
```

Two separate consequences, routinely confused:

**Homogenisation is a result, not a bug.** Under union, both directions drive every member to the
same tag set: scenes S1{A} and S2{C} in group G{B} converge on {A,B,C}. That is what running both
directions *means*, and it settles in two rounds. But a user who enabled each half because it
looked reasonable alone will not expect it, so the dialog says so (`pairedBoth`) and offers the two
ways out: disable one, or turn on "common tags only" for the aggregating half, which leaves almost
nothing to push back down.

**Auto-mode ping-pong is a bug, and needs the cooldown.** Each write triggers the other's reaction.
`guarded()`/`_writeDepth` does **not** cover this — it suppresses our own writes inside one
reaction, not the second reaction that the first one's mutation triggers. `NormalizeParentTags`'
per-entity cooldown is the defence and `MergePerformerTagsToScenes` has no equivalent, so it cannot
be copied from the nearer sibling. **Auto mode and the cooldown ship in the same step, never one
without the other** — that is step 6, and it is the whole reason those two are one step.

The *paths* need no such coupling and shipped with the rest at 0.2.0. Under the task neither
consequence is a hazard: one run applies each direction once, in a fixed order, and the plan-aware
gather means the second direction reads what the first one decided rather than racing it.

## 4. Settings

Ten keys since 3.0.0, prefix-ordered because `settings:` is a YAML map — the declaration order is
gone by the time Stash has parsed it and the page renders the keys sorted alphabetically. Blocks:
`a1`–`a4` what starts a run, `b1Paths` every path in one string, `f` the exclusion filters, `g`
logging. The `c`, `d` and `e` blocks were the paths grouped by what they write onto and are gone;
that grouping is now the Path Settings dialog's own headings, where it can be a heading rather than
a letter.

**The letters differ from the siblings and the suffixes do not.**
`ExcludeTagWithIgnoreAutoTag` is the same words in all three plugins; only the prefix moved, because
this plugin has five blocks of paths that they do not have. Keep the suffixes recognisable.

**A key is the storage key.** Renaming one silently resets it for every install and strands the old
value in the config. New settings take a prefix inside the block they belong to; if a block is full,
renumber that whole block in one go rather than bolting on a `b5a`.

**`a2SaveImmediately` is inverted on purpose**, the one setting here that is. Stash has no default
for a plugin setting and renders an unset `BOOLEAN` as unchecked, so the behaviour we want by
default (staging) has to be what "off" selects. Otherwise the box would read off while acting on,
and the first click on it would send `true`. Every path toggle is off by default for the opposite
reason: these are library-wide writes, and opting in per path is how the user says which
relationships they have thought about.

**`PATHS` used to be a second place the manifest keys lived**, and a path naming a key the manifest
did not declare read as `false` forever — configurable in the UI and inert in the run, with nothing
failing loudly. There are no per-path keys any more, so that whole class of drift is gone;
`tests/propagate-paths.test.js` now pins the opposite, that no path carries a setting key at all.

## 4a. The planner (0.2.0)

**Target-centric, and grouped into passes by stage and then by target.** Three paths writing tags
onto scenes in stage 2 are one query per page, not three — repeating a field is legal GraphQL and
the server merges the selections, so two paths sharing a walk prefix cost nothing. Grouping across
*stages* would be cheaper still and is wrong: the stage boundary is what makes the cascade work.

**The plan is keyed by the entity being written and what is being written to it** — `target:kind:id`
— never by the path that asked. A scene wanting tags from its performers, its studio and its markers
is one entry carrying the union, because the write is one delta on one entity. This is the sibling's
§7a rule and it is the one thing here that would silently lose data if rearranged.

**The cascade is the part that is easy to miss.** Paths cascade, but the review happens before any
write, so "read the sources fresh at each stage" cannot mean re-reading the server — nothing has
been written yet. It means reading the *plan*: when stage 4 copies a scene's tags onto its group, it
counts whatever stage 2 already planned for that scene as though it were there. `plannedFor()` does
this by looking the entry up in `planIndex`, so there is one answer to "what will this entity end up
with" and no second structure to disagree with the plan.

Three consequences:

- Every walk asks for the **source entity's own id**, because that is what the lookup is keyed on.
  It is not decoration, and `propagate-paths` pins it.
- `sourceType` on each path says what the walk lands on. The cascade applies only where that is
  itself one of our targets — seven of the thirteen paths. Performers, studios and markers are never
  targets, so nothing can ever be pending for them.
- Without it, the cascade still *happens*, just one run later, and nothing errors. That is why the
  test for it is paired with a negative: the same library with only the group path enabled must gain
  nothing, or the check would pass on the group path merely working.

**Deep group nesting is one level per run.** Stage 5 rolls sub-groups into their containing group,
but a sub-group that itself gained tags in stage 5 is not re-read within that stage. Rescan is the
answer, as it is for everything else the plan cannot see.

**Union versus common-tags-only** is a count against the number of sources. Two edges to keep true:
one source makes the two modes the same answer, and zero sources adds nothing under *either* — the
intersection of no sets is emptiness here, not everything, because a group with no scenes has no
scenes agreeing on anything. A source listing the same tag twice counts once, or it would look like
two sources agreeing.

**The exclusion filters, and what they cannot do.** Entity-level (`f1`, `f2`) skips a whole target;
tag-level (`f3`, `f4`) refuses one tag wherever it would land. A **performer** has no "ignore auto
tag" and no custom fields, so the two performer paths are governed by the entity-level filters
alone — the settings say "tags" for that reason. Two rules carried from the sibling: the exclusion
tag is resolved against the tag list already in hand (exact, case-sensitive — Stash compiles
`EQUALS` to SQL `LIKE`, where `_` and `%` are wildcards), and **failing to resolve it stops the
run** rather than planning unfiltered, because running without it would write to the very entities
it is there to protect and nothing here removes anything afterwards. The exclusion tag is also never
copied onto anything, or whatever received it would be permanently excluded.

**Naming.** Tags are named from the one `findTags` query every run makes anyway; `custom_fields` is
requested only when that filter is set. Everything else carries its name on the traversal instead,
because fetching every performer in the library to name the handful a plan mentions would be a query
for a log line. `entityLabel` reads whichever of `files` / `visual_files` / `folder` is present
rather than switching on the target type — a per-type branch there is what let galleries and images
log as "untitled" in the sibling for three releases.

**Attribution names the source entity** (0.3.1). A line reads `- from Performer "Jane" (7)`, not
`- from Performers`. Naming the path answered "which rule fired", which the rest of the line
already implies; naming the entity answers "which performer", which is the thing the user has to
open to understand or reverse a copy by hand. It cost a name field on every traversal — `SOURCES`,
which is where the seven source types get a singular label and the fields their label reads.

Four rules it turns on:

- **`SOURCES` reuses `TARGETS` for the four types that are both.** Two field lists for one entity
  are two lists that can drift, and the fallback chain reads whichever of `title` / `name` /
  `files` / `visual_files` / `folder` is present — the same chain `entityLabel` uses, for the same
  reason it does not switch on type.
- **Only the leaf of a walk is named.** An intermediate step is passed through and never logged;
  naming it would put a join on every scene under every group for a string nobody reads.
- **One name and a count**, `Performer "Jane" (7), +2 more`. A scene with forty performers would
  otherwise put forty of them on one line, and the first in walk order is enough to start from —
  walk order being what makes it the same name on every run.
- **The count is over the sources of the path that supplied it first**, not over every path. A tag
  reaching a scene from both its studio and a performer is one addition, attributed to whichever
  path reached it; counting across paths would mean holding attribution for additions never made.

Attribution is computed once, in phase 1, and held on the plan entry. Phase 2 and Undo read it back
rather than recomputing — by then the sources are long out of scope, and a batch groups entities
that wanted the same tag for different reasons, which is why the line is built per entry and never
per batch.

A **titleless marker is named by its primary tag**, which is what Stash shows on the scene's marker
list and which every marker path already selects. Marker titles are optional and usually blank, so
this is the common case rather than a fallback.

**A failed page is logged and the pass carries on.** One bad page must not cancel a library-wide
review, and a plan that is honest about being partial beats one that is quietly short. A failed
*tag* query is different and stops the run: it answers the filters and names everything, so there is
no run without it.

## 4b. Applying, and Undo (0.3.0)

**Every write is an ADD delta, never a rewritten list.** Two reasons, and the second is the one that
matters: a delta is applied by the server against the entity as it is *now*, so a tag someone added
from another tab between the scan and the apply is not silently reverted — which a full list built
from phase-1 data would do. It also lets entities sharing an addition be written together, which is
what turns tens of thousands of mutations into a few hundred.

`buildBatches` groups by `target | kind | sorted ids` and chunks at `CHUNK_SIZE`. Grouping is per
target *and* per kind because each pair has its own mutation and its own `BulkUpdateIds` field.

**Recorded on success only.** A batch enters `undoable` after the server has accepted it, so Undo
can never try to reverse a write that never landed, and a failed batch is neither logged as written
nor counted in the applied recap. That recap is accumulated from the writes rather than from the
plan — the two differing is meaningful, not a fault.

**Phase 2 reads nothing.** It applies the plan the user approved and nothing else. Re-reading the
library here would mean writing something that was never reviewed, and it is precisely what Rescan
does instead — deliberately and on request.

**`guarded()` around the whole apply, not per batch.** Every batch is a `bulk*Update`, which is
exactly what this plugin's own auto mode will watch for at step 6, so without it a run with an auto
mode enabled would re-plan each batch it had just written. Per batch would re-open interception
between them. The lease cannot do this job: it is advisory, and we honour our own leases no more
than anyone else's.

**The lease is renewed per batch and released in every outcome** — success, failure, Stop — so a
reactive plugin is never left standing down. The expiry is the backstop for the one outcome neither
can catch: the tab going away mid-run.

### Undo

**The only code in this plugin that removes anything.** §1's "copy, never move" is written around
this exception rather than despite it.

- **A delta, not a restore.** It replays each accepted batch with `REMOVE` in place of `ADD`, taking
  back precisely what this run added and touching nothing else. Storing each entity's pre-run list
  and writing it back would be simpler and wrong: it would revert every unrelated edit made in
  between, which is the one thing an undo must not do.
- **Newest batch first.** A rescan-and-apply cycle can write to one entity twice, and taking the
  second write back before the first is the only order that lands where the run started.
- **It arms and asks**, with the count in the caption. One click here starts a library-wide write in
  the state where the user is most likely to be clicking around — Copy log, Rescan and Close are its
  neighbours. The count is what makes the prompt worth reading: it states the scope rather than
  asking a generic "are you sure".
- **Offered in `ready` as well as `done`**, because a rescan leaves the dialog holding a fresh plan
  over a library an earlier pass already changed — exactly when the user is choosing between
  applying more and taking back what is there. It always finishes in `done`: a plan reviewed against
  the library as it was no longer describes it.
- **Session-scoped.** `rescan()` carries `undoable` across the reset, like `lines`. Converging on an
  empty plan is the normal way to finish a run, and losing the ability to undo at that moment would
  be the worst possible time for it.
- **Guarded, and leased as `<task> (undo)`.** More sharply than the apply: an undo writes the
  inverse delta, so an auto mode reacting to it would put back exactly what the user just asked to
  have taken away.
- **Never gated on the version check.** It reverses writes this dialog already made, and stranding
  the user with changes they cannot take back is worse than the mismatch being guarded against.

### The log's two halves read alike

Phase 1 and phase 2 emit the same `[TAG]` / `[PERF]` lines — they describe the same changes, once as
a plan and once as a fact — and the `Applying N entity changes - <timestamp>` header is what
separates them. This is the siblings' convention and it caught out the first version of
`propagate-apply.test.js`, which read the whole log and thought it had seen a write. Any check about
what was *written* has to read below that header.

## 4c. The sweep: a gallery's images (0.4.0)

Eleven paths walk down fields of the target. The last two cannot: **`Gallery` has no `images`
field** — only `image_count` and `image(index)` — so the sources of `tags:image>gallery` and
`performers:image>gallery` have to be found from the other end. `reverse: { backRef: 'galleries' }`
names the field on the *source* that points at the target, and everything else about the query
comes from the source's own `TARGETS` entry, so there is no second copy of `findImages` to fall out
of step. A reverse path's `sourceType` must therefore be a target type; `propagate-paths` pins it.

**One sweep over every image, not one query per gallery.** The design sketched
`findImages(image_filter: { galleries: { value: [id], modifier: INCLUDES_ALL } }, per_page: -1)`
per gallery, by analogy with the sibling's per-performer scene query. That is worse in the two ways
that matter here: it costs a request per gallery, and `per_page: -1` against a gallery holding
twenty thousand images returns twenty thousand images in one response — the six-figure hazard the
design flagged, reintroduced by the query meant to avoid it. Sweeping pages uniformly, never builds
an unbounded response, and costs requests in proportion to the library rather than to the number of
galleries.

**The sweep runs at the start of its own pass, and both reverse paths sweep separately.** They sit
in different stages — performers in 1, tags in 3, because the tag paths read performers — so a
shared sweep would have to be taken once and reused across a stage boundary. It would halve the
requests in the one configuration where both are enabled, and it would move the correctness
argument into a comment: reuse is safe only while nothing between the two stages plans onto images,
which is true today and is not a property the path table promises. Sweeping per pass reads the plan
exactly where a walk would, so the cascade means the same thing whichever way the sources arrived.
Two passes over every image is the price, and both setting descriptions say so.

**One aggregation, two ways in.** `addSource`/`aggregate` hold what a set of sources contributes to
one target — `n`, `counts`, `order`, `first` — and a walk and a sweep both go through it. The two
were briefly separate and that is exactly the shape that drifts: the cascade, the count "common tags
only" divides by, and which source gets named would each have had two implementations.

**An image in two galleries counts for both.** It is added once per target it names, not once, or
the second gallery would silently lose it.

**A failed sweep page is logged and the pass carries on**, like a failed target page. Short rather
than wrong: every gallery it does reach is planned from every image it did read.

**The sweep gets its own progress segment**, and the pass counts as started only when it reaches its
targets — otherwise a target count of `0 / 0` sits beside a sweep that will run for a minute, which
reads as a stalled pass.

## 4d. Auto mode, target side (0.5.0)

The first thing here that writes without a Proceed button. Half of step 6: it reacts when one of the
four **targets** is saved. The source side — a save of a performer, a studio, a marker fanning out
to everything that reads it — is §4e below, one minor version later.

**`AutoRun` borrows `Run`'s planner rather than owning one.** `planEntry`, `plannedFor`,
`addSource`, `aggregate` and `planTarget` are assigned onto its prototype from `Run`'s. This is the
single most important thing in the section: a second planner would be free to drift from the one the
review dialog shows, and the *only* evidence a user has about what auto mode does is that the task
agrees with it. What differs is the driver — entities named rather than paged, no dialog, the log
going to the console.

The same argument produced two extractions:

- **`targetParts(pass)`**, shared by `passQuery` (the library walk) and `oneQuery` (auto mode's
  fetch of one entity). A field present in one copy and missing from the other is a path that
  silently plans nothing, and the same selection is what the "already has this" diff reads.
- **`resolveExclusionTagId(settings, tagMap)`**, shared by the scan and a reaction. Both let it
  throw: running unfiltered would copy onto the entities the filter exists to protect.

**`guarded()` wraps the whole reaction, and it is not decoration.** `bulkSceneUpdate` is precisely
what the branch that starts a reaction watches for, so without it every reaction would react to
itself. The cooldown would stop the recursion after one round — which is exactly why it must not be
the thing relied on: the round still costs a full pointless pass. The test asserts one
single-entity fetch per save, and a mutant that drops the guard fails it.

**The cooldown is for the *next* save, not this one.** `markWritten` / `cooledDown`, keyed
`target:id`, 8 s. It exists for the two reversible pairs: our write to a group is a group save,
which would propagate back to every scene in it, whose writes are scene saves. Union reaches a fixed
point so it terminates, but not before a burst of real writes. Three details:

- **Keyed per entity, never globally.** A save of scene 7 must not be ignored because scene 9 was
  written a second ago.
- **Marked only on success.** An entity we failed to write has not been written, and shielding it
  would silently skip the retry.
- **Swept on insert, above `AUTO_COOLDOWN_MAX`.** A timer would keep the tab awake to tidy a map
  nobody is reading.

**`mutationSucceeded` clones the response**, exactly as the sibling's does and for the same reason:
`fetch` resolves for an HTTP 500 and for a GraphQL error returned with HTTP 200. Our handler is
attached before Apollo's, so the body is unread and the clone is safe; a clone that fails assumes
success rather than dropping the reaction. Reacting to a save Stash rejected would copy tags on the
strength of an edit that never happened.

**The reverse paths use the per-target filtered query step 5 rejected** — `findImages` filtered to
one gallery — and that is not a reversal. What step 5 rejected was *a request per gallery across the
whole library*, to gather what one sweep gathers in one pass, and the hazard it actually named was
the unbounded response of `per_page: -1`. Here there is exactly one gallery, the one just saved, and
sweeping every image in the library to find its images would be absurd. `reverseQuery` pages like
everything else, so nothing is reintroduced. `reverse.backRef` doubles as the filter field name
(`Image.galleries` / `image_filter: { galleries: … }`); that is a convenience of Stash's naming and
not a rule it promises.

**Settings are cached with a TTL, and invalidated by our own `configurePlugin`.** Every mutation in
the UI reaches the fetch wrapper, and `configuration { plugins }` cannot be scoped to one plugin, so
reading them per mutation would put a full settings query behind every save. One in-flight load is
shared, so two quick saves are one load.

**`autoSuppressed()` is called after the mutation matches, not before**, so the one-time "standing
down" console line is only emitted for a save that would actually have been reacted to. Same shape
as the sibling's.

**`targetOfMutation` needs both regexes.** `/\bsceneUpdate\b/` does not match `bulkSceneUpdate` —
the capital S breaks the word boundary — and the two read their ids from different places
(`input.id` against `input.ids`).

**A reaction's failure is never rethrown into Stash's fetch chain.** The user's save succeeded; a
failed reaction to it must not look like a failed save.

## 4e. Auto mode, source side (0.6.0)

The other half of step 6: a save of a **Performer, Studio, SceneMarker**, or of a Scene, Gallery,
Image or Group acting as a *source* rather than a target, fans out to every target an enabled path
would have copied it onto. Enabling this on a popular performer's tag is genuinely expensive — the
setting's own description says so — but the mechanism reuses everything §4d built rather than
carrying a second write path.

**Once the affected target ids are known, a source reaction *is* a target reaction.**
`runAutoTargets(target, ids, settings, label)` is what §4d's `reactToTargets` was split into: the
cooldown, `guarded()`, the lease, `AutoRun`'s planner, all of it, called identically by both modes.
The only thing this section adds is finding those ids — `resolveSourceTargets` — and a wider
mutation matcher, `sourceOfMutation`, that recognises every entity type a `PATHS` entry ever reads
from rather than only the four it ever writes to.

**Two shapes of lookup, one per path, in `SOURCE_REVERSE`:**

- **`kind: 'field'`** — most paths have a plain field on the source pointing back at what refers to
  it: `Image.galleries`, `Gallery.scenes`, `Scene.groups`, `Group.scenes`, `Group.containing_groups`,
  `SceneMarker.scene`. One query per saved entity, no filter guessing. `tags:marker>group` and
  `performers:marker>group`'s tag counterpart chain two of these in **one** query rather than two
  round trips — `scene { groups { group { id } } }` off a single `findSceneMarker` — because a
  marker names exactly one scene, so there is nothing to page between the hops.
- **`kind: 'filter'`** — three paths have no back-reference to walk: a Performer and a Studio carry
  no field naming the Scenes or Groups that use them, and a Gallery has no `images` field, the same
  reason the sweep exists (§4c). These go through a filter on the *target's* own filter type —
  `scene_filter: { performers: { value: [$id], modifier: INCLUDES } }` — which is exactly the shape
  `reverseQuery` already trusts Stash to have for `Image.galleries`, generalised, and no more
  verified against a running instance than that was until 0.4.0. `tags:performer>group` reuses the
  same `performers` filter as `tags:performer>scene` but asks for `groups { group { id } }` in the
  same response, so the second hop costs nothing extra either.

**Every one of the thirteen has an entry, and `propagate-auto-source.test.js` pins that a `PATHS`
entry without one fails loudly** rather than silently doing nothing — the same shape of guarantee
`propagate-paths.test.js` gives the settings table.

**Filter-kind lookups page, field-kind lookups do not need to.** A performer with a six-figure scene
count is exactly the unbounded-response hazard §4c already named; a marker's single `scene` field or
a gallery's `scenes` list is not paginated in Stash's own schema, so there is nothing to page.

**Sequential per source id, not one combined query, even for a bulk save.** Every other reverse
lookup in this plugin already works this way — `AutoRun.reverseSources` fetches one target's sources
at a time — and a bulk save of *sources* is the uncommon case here, not the one worth a second query
shape for. The affected target ids are deduplicated across every source id before `runAutoTargets`
sees them, so two performers naming the same scene refresh it once, not twice.

**One save can be both a target and a source, and both reactions run.** A Scene is a target of its
own paths and, via `tags:scene>group`, a source for its group's. `targetOfMutation` and
`sourceOfMutation` are checked independently in the fetch wrapper off the same mutation, each gated
on its own setting (`a3` / `a4`) and its own cooldown check, because they write to different
entities and answer different questions — "refresh this" against "propagate this outward."

**A source reaction resolves ids with plain reads, never mutations**, so nothing here needs
`guarded()` of its own — only `runAutoTargets`'s write does, exactly as it did for the target side.
The resolution queries do not match `targetOfMutation` or `sourceOfMutation` at all, being `find*`
reads rather than `*Update` mutations, so there is no risk of a lookup being mistaken for a save
worth reacting to.

## 5. The dialog (0.1.0)

Ported from both siblings and deliberately identical to them: same head with a backup warning and an
id legend, same monospace log with a rendered tail, same footer, same `scanning|ready|applying|
undoing|done` state machine. The overlapping CSS is byte-identical across every plugin here and
`tests/style.test.js` fails on any drift — see the repo-root CLAUDE.md.

**Before the planner runs it reviews the configuration.** Worth keeping separate from §4a, because
it is what tells the user whether the plan they are about to read was computed from the settings
they meant:

- names the enabled paths **in pipeline order**, because that order decides what one run reaches
- warns when both halves of a reversible pair are on
- names every exclusion filter in force, and says so explicitly when none is
- warns about another plugin's lease, without standing down
- notes another relationship-copying plugin declaring one of the same paths (§5a)
- warns about NormalizeParentTags' Prune/Roll Up modes, where they collide with an addition (§5a)
- compares the running script against the installed manifest

**The version gate is the only warning here that blocks.** Every other one — the lease, the pair, a
sibling's auto mode — is about the library or another plugin, where the user knows more than the
dialog does. This one is about the dialog running code the user has already replaced, which is the
one thing they cannot see. Three things keep it from being obstructive: unknown is never a mismatch
(a Stash too old for the field, a plugin it cannot see, a failed request all resolve to `null`); the
two quiet outcomes go to the console rather than the log; and **Undo is never gated on it**, because
stranding the user with changes they cannot take back is worse than the mismatch.

**One counter, since 1.2.0.** `lines` is the export buffer and survives a Rescan, because Copy log
hands over the whole session — and so does the rendered log now, so `lines.length` is what the
progress line describes. There were two while a rescan emptied the view: `viewLines` counted the
current pass, because reporting `lines` over an emptied view produced, in the sibling, a header
claiming 28 161 lines over a log holding four. Keeping the view removed the divergence rather than
the symptom, so the second counter went with it.

## 5a. Two other plugins, two different kinds of collision (0.7.0)

Step 7 of the design plan. Both checks run from `begin()`, right after the reversible-pair warning,
and both are informational log lines rather than head warnings — neither collision is a hazard the
version gate's "you cannot see this" sense is. Full design reasoning is in "Cross-plugin
cooperation: the `declares` registry" in the repo-root CLAUDE.md; this section is the map of the
code that implements it.

**`checkDeclaredOverlap` — the same path, run by someone else.** `MergePerformerTagsToScenes`
implements exactly one of this plugin's thirteen paths (`tags:performer>scene`) and declares it
unconditionally at its own load, into `coop().declares[MergePerformerTagsToScenes]`. This plugin
does the reverse: on every settings load — the task's own and auto mode's `autoSettings` refresh
alike, via the shared `publishDeclares(settings)` — it republishes its *currently enabled* path ids
into `coop().declares[PLUGIN_ID]`, because a path whose setting is off is not one it is actually
covering. `checkDeclaredOverlap(paths)` then scans the registry for any other plugin id whose array
names one of `paths`, and logs one line per other plugin naming every overlapping path label. This
is deliberately generic on both sides: nothing here names `MergePerformerTagsToScenes`, so a second
relationship-copying plugin needs no edit to either.

**`checkHierarchySibling` — a different kind of collision, and not part of `declares`.** Ported
from `MergePerformerTagsToScenes`' own `checkSibling`, reading `NormalizeParentTags`' raw settings
(`a1AutoModes` since its 4.0.0, the `a8AutoPruneOnUpdate` / `a9AutoRollUpOnUpdate` pair it replaced
before that — `nptAutoModes` reads whichever is there) out of the same `{ configuration { plugins } }`
response `loadSettings()` already fetches — `loaded.all[NPT_ID]`, no second query. Unlike the
overlap above, this is not "the same path": Prune can remove any tag this run adds regardless of
which of the eleven tag paths added it, and Roll Up piles ancestors on top of it the same way. That
is a category-level interaction (a hierarchy-rewriter versus any additive tag-writer), which has no
path id on either side for a generic registry scan to match — hence a name-based check reading a
named sibling's actual settings, exactly like the one it was ported from. `NPT_ID`/`NPT_NAME` are
this plugin's only hardcoded reference to another plugin, for exactly this reason.

Both halves of NPT's own no-op are handled the same way as the sibling's version: prune and roll-up
both on cancels out to nothing worth warning about, and "registered as a lease respecter" is
reported rather than warned about, since a respecting NPT will stand down while this task writes.

**Why one plugin gets a generic mechanism and the other gets a ported bespoke one, in the same
version.** They are answers to two different questions that happen to have arrived in the same
step: "is another plugin doing what I am doing" generalises cleanly across an open-ended set of
future plugins and needs no name; "does a hierarchy rewrite undo what I just added" is inherently
about one specific *kind* of plugin NPT is the only example of here, and forcing it into the path-id
vocabulary would need a second, richer vocabulary (categories, not paths, plus a collision matrix)
that nothing here needs yet.

## 5b. Manual buttons and staging (0.8.0, best-effort; fixed at 0.8.1, 0.8.2 and 0.8.3)

D8 of the design plan, built without a running Stash to check the DOM against — the plan's own
caveat, carried forward rather than resolved. One button per enabled path whose target is the page
being viewed: `path.button` is already the label (set at 0.0.1), so nothing here invents a second
copy of the thirteen strings.

**`findManualButtonContainer` tries two containers, not one** (0.8.2). `.edit-buttons` first — the
one Scene is confirmed to use — and, failing that, whichever `.details-edit` does not carry a
`button.delete`. `.details-edit` is not new to this repo: `MergePerformerTagsToScenes`' own
performer button already reads it, for the *other* state of the same swap (it wants the detail-view
navbar, carrying Delete; this plugin wants the edit form, which does not). Group is confirmed live
to need the fallback; Gallery and Image are unconfirmed either way.

**No second planner.** `AutoRun` already plans a *named* set of ids without paging the library —
exactly what one entity is — so a click reuses it verbatim: `autoSettings()` for the cached
settings, `autoContext(s)` for the tag hierarchy and filters, `new AutoRun(s, ...)`,
`run.planEntities(target, paths, [id])`. The only new code is where the result goes.

**Two destinations, one `s.a2SaveImmediately` switch away from each other.** *(0.18.0 replaced the
first of them: it opened the review dialog instead of writing — see §5h. The paragraph stands as the
record of what the switch used to select.)* "Save immediately" called `run.apply(label)` unchanged —
the exact function auto mode's target-side
reaction calls. Staging (the default) reads `run.plan` instead and pushes each entry's `add` ids
into a captured form control. Names for staged items come free: `run.tagMap` (built for the
exclusion filters anyway) for tags, `run.performerNames` (built by `AutoRun`'s own `addSource` while
walking any performers-kind path) for performers. Staging costs no query beyond what planning
already made.

**Capturing the form controls generalises MergePerformerTagsToScenes' one `TagSelect` capture to
two components, keyed by route instead of by scene id.** `installSelectPatches()` patches both
`TagSelect` and `PerformerSelect` through `PluginApi.patch.before`, and `captureSelect` records
`(target, id)` from `currentRouteTarget()` — the same `TARGETS[key].route` regex every other part of
this plugin already uses, so there is no second copy of the four route patterns. `findControl`
carries over the sibling's exact reasoning: newest capture first, preferring one whose `values`
match what this plugin last staged, because matching the *server's* tags would keep re-selecting
the pre-staging capture and report the same count on every click.

**The diff is against the form, not the server**, for the same reason as the sibling: a tag the
user added or removed by hand survives, and a second click without saving reports "No changes"
rather than restaging what is already there. `stageEntry` is the one function both kinds
(`_tagCaptures`/`_stagedTags` and `_perfCaptures`/`_stagedPerfs`) go through, parameterised by which
pair to read and write — two captures and two "expected" trackers because a scene page can stage
tags *and* performers in the same click, and they are different controls.

**A button that finds no control throws, which surfaces as an alert naming "open the Edit tab
first."** This is deliberately not swallowed into "No changes" - the two are different facts (the
run added nothing, versus the run could not tell what was already there) and conflating them would
hide a genuine placement failure behind the same caption a normal no-op shows.

**Reconciliation, not tracking.** `manualButtonsTick()` rebuilds its opinion of which buttons should
exist from `enabledPaths(s)` and the route on every tick, the same philosophy as `ensureReadmeLink`
and `settingsTick` elsewhere in this file: React can tear down and rebuild `.edit-buttons` on a
re-render, so there is nothing durable to track. A button is kept when both its path is still
enabled and its `_ptp2reEntityId` matches the current route; anything else is removed. **Only one of
the two removal paths does the entity-id check** — a button for a path that is still enabled but the
wrong entity is caught by the *per-path* loop (`existing._ptp2reEntityId === rt.id` failing before a
replacement is appended), so the reconciliation loop above it only has to ask "is this path still
wanted at all." A mutation test confirmed the second check in that loop was dead: removing it changed
nothing, because the per-path loop already covers the case.

**A `MutationObserver`, unlike the settings page's tick.** `ensureReadmeLink`'s comment explaining
why it has none does not apply here: a button has to land before the user can click it, and Stash's
edit forms re-render on every keystroke, so polling alone would leave it flickering. `startEntityObserver`
is `MergePerformerTagsToScenes`' own `startObserver`, ported rather than shared — the two plugins
carry no module between them — watching `#root` (falling back to `document.body`) and coalescing a
burst of mutations into one tick via a 100ms `setTimeout`, exactly like the sibling's.

**What is genuinely unverified**, beyond `.edit-buttons` itself (§5's own caveat): the shape of a
`PerformerSelect` item — only `id` is used to build the diff-against-form `have` map, but `onSelect`
is handed `{ id, name }` for a staged item, and whether Stash's control needs more than that to
render a chip has never been checked against a running instance. The equivalent question for
`TagSelect` items (`aliases`, `image_path`) is answered by the sibling's own working code, which
this plugin's staged item deliberately mirrors (`{ id, name, aliases: [], image_path: null }`) —
empty rather than omitted, on the chance the control's renderer expects the keys to exist even
when there is nothing in them.

## 5c. Button size, enabling logic, naming, and the source side (0.9.0)

Four "Button Improvement" TODOs came out of the same round of 0.8.x live testing, discussed with
the user before any of them were built (§8 records the discussion and the decisions). Two were
built as fixes, one as a rename, and one — deliberately narrower than first discussed — as a new
half of the feature. Improvement 4 (hide a button that would add nothing) stayed a deferred
"maybe" until **0.13.0**, which is §5e below; the stated preference at the time was a button that
is sometimes unneeded over one that is missing when it was needed, and that preference is what
0.9.0's existence gating was careful not to violate. Read this section for what existence gating
was and why, then §5e for what replaced it.

**Button size (Improvement 1) was never actually about `align-items: stretch`.** 0.8.3 fixed a
*relative* problem — our own buttons rendering at two different heights depending on which row they
landed in — with `align-self: flex-start`. It did not fix the *absolute* one: every manual button
still used the shared `button()` helper, which carries `btn-sm` for the dialog's own footer.
`MergePerformerTagsToScenes`' on-page buttons and Stash's own Save/Delete carry plain
`btn btn-secondary` with no size modifier, so a `btn-sm` button beside them read smaller — in both
height *and* font-size — on every row, not only a mismatched one. `buildManualButton` now builds
its own element with `el()` instead of calling `button()`, and `align-self: flex-start` stays, since
dropping `btn-sm` does not remove the *relative* hazard, only shrinks how often it would be visible.

**Enabling logic (Improvement 2) is existence gating, and it is deliberately not Improvement 4.**
The live bug: "Add Perf Tags" already hid itself when a scene had no performers, because
`MergePerformerTagsToScenes`' own scene button gates on exactly that (`checkSceneHasPerformers`) —
but every other manual button here showed regardless, since eligibility gating was walked back at
0.8.0 on purpose (see the `a1ShowManualButtons` setting history). That inconsistency, not the
absence of full eligibility gating, is the bug: a button should hide when its *source does not
exist at all*, the same question `MergePerformerTagsToScenes` already answers for its one button —
not "would a click actually change anything," which stays Improvement 4's question and stays
deferred.

**`MergePerformerTagsToScenes`' own *performer*-page button was stricter still, and was
deliberately not matched — until 0.13.0, when matching it became the point.** Its
`checkPerformerHasScenes` gates on `hasTags && hasScenes` — the performer must carry at least one
tag, not merely appear in a scene — while its *scene*-page button (`checkSceneHasPerformers`) gated
on performer existence alone, the one this plugin's own existence gating was modelled on. That
inconsistency between MPTTS' own two buttons was read here, at 0.9.0, as the same trade this plugin
was making on purpose. **It was not a trade on that side.** Its performer button carries a comment
explaining the stronger gate ("a performer with no tags has nothing to merge, so the button would be
a dead click"); its scene button carries no counter-argument anywhere in its code or its CLAUDE.md.
The likelier reading is that one side got the reasoning and the other was never revisited — and
0.9.0 cited it as precedent for a decision nobody had made. **Check whether a sibling's behaviour is
argued for before citing it as an argument.** Both plugins gate on eligibility from 0.13.0 / 1.16.0.

`Run.prototype.planTarget` (shared with `AutoRun` via the same `['planEntry', 'plannedFor',
'addSource', 'aggregate', 'planTarget']` assignment §4d already relies on) gained one hook, called
before the "nothing to aggregate" early return that decides eligibility: `self.recordExistence(path.id,
!!(agg && agg.n))`. It is a no-op everywhere except `checkButtonExistence`, which sets it, runs
`AutoRun.planEntities` for exactly the paths a page is about to offer, and reads back which of them
found any source at all. Existence and eligibility read the *same* `agg.n` the diff itself reads,
computed *before* the diff — so a button's visibility can never disagree with what a click into the
same entity would compute, and the two questions stay genuinely separate rather than one being a
cheaper approximation of the other that could drift.

**Cached exactly like `MergePerformerTagsToScenes`' `sceneCheck`/`performerCheck`** — a single
mutable slot, not a map, because one page is in view at a time. Keyed on the *path set* as well as
the entity, via `pathIdsKey`, so toggling a path's setting while the page is open re-probes without
needing a navigation to notice. A failed probe (the tag query `autoContext` needs, most likely) sets
`has: null`, read downstream as "show everything" rather than "hide everything" — the stated
preference applied to the one place a network hiccup could otherwise violate it.

**The probe is what a button waits on, so it is the only place either query shape is tuned for
latency** (0.12.11). Live-reported: this plugin's buttons appeared about a second after
`MergePerformerTagsToScenes`' on the same page. Neither tick loop was at fault — both poll at 1 s and
coalesce observer bursts identically, and this plugin re-ticks the instant a probe resolves while the
sibling waits for the next tick. The difference was entirely what each probe costs: the sibling asks
one small combined query, and this one asked `tagQuery` — the whole tag library — on every
navigation, plus one round trip per source path *in series*. Two changes, one per side:

- **`probeContext(s)` caches `autoContext`'s result on the settings TTL, for the probe only.** The
  comment above `autoContext` explaining why it is deliberately uncached still holds for every other
  caller: a stale exclusion tag would mean writing to the entities it exists to protect. A probe
  never writes — it decides whether to *show* a button — so the worst a stale answer costs is one
  button shown or hidden for a few seconds. `invalidateAutoSettings` drops it too, so saving a
  filter setting re-probes at once rather than waiting the TTL out.
- **`checkSourceButtonExistence` fires its per-path lookups with `Promise.all`.** This is not a
  reversal of §4e's "sequential per source id": that rule is about not firing a query per entity
  across a whole library, and a handful of paths on one page is not that.

0.12.11 fixed the target side and left the source side almost untouched — `probeContext` is never
reached from a Performer or Studio page, and `Promise.all` over a single enabled path is the same one
query it always was. Live feedback said as much: still a small delay. Two more, and between them they
are the reason the *sibling* has never had one:

- **`autoSettings()` serves the last known settings and revalidates behind itself.** This is the one
  that applied to every page. Awaiting a lapsed TTL means one tick in ten blocks on a full
  `configuration { plugins }` query before it can even look at the DOM, and the ticks that draw
  buttons run every second — so on any given navigation there is a real chance the tick that would
  have drawn the button is the one paying for the reload. `MergePerformerTagsToScenes` never had this
  because it reads a plain object synchronously and refreshes it on a separate timer; this is the
  same shape without a second copy of the settings. **The staleness window is the one the TTL already
  opened** — every caller was always working from settings up to ten seconds old — and our own save
  calls `invalidateAutoSettings`, which *clears* the value rather than ageing it, so a setting the
  user just changed is never served stale.
- **The probe's filter lookups stop at the first page that found something**
  (`resolveFilterReverse`'s `anyIsEnough`). The probe asks only whether the list comes back empty, and
  a studio with five thousand scenes was paging through all of them to decide whether to draw one
  button — a delay that scaled with how busy the entity was. It stops on a page that *yielded*
  something, never on an empty one, so a two-hop pick that legitimately finds nothing on page 1 pages
  on exactly as before and the answer is identical to a full walk. That equivalence is what keeps
  §5c's "button and click can never disagree" true.

**0.12.13 is the one that was measured, and it is the one that mattered.** 0.12.11 and 0.12.12 were
both derived by reading the code for plausible costs, and both removed real work without moving the
number the user could see. A `fetch` wrapper logging every operation with its duration, against a
button-visibility observer, settled it in one paste on a Scene Edit tab:

```
→  4447ms  PTPTags
←  5212ms  PTPTags  (766ms)          <- the whole tag library
→  5214 / 5233 / 5387  PTP_one_findScene  (19 / 81 / 287ms, sequential passes)
★  5677ms  PTP2RE target button visible
```

766 ms of 1230 ms was the tag query — the thing 0.12.11 had already "fixed" by caching it on the
*settings* TTL. Ten seconds is shorter than the gap between two visits to an edit tab, so it was
paid again nearly every time and the delay stayed exactly where it was. **A cache whose TTL is
shorter than the interval between uses is not a cache**, and the TTL was copied from a neighbour
rather than sized against what it was actually protecting. `PROBE_CTX_TTL_MS` is now its own
constant at five minutes, sized against the only thing a stale probe context can cost: how long a
button may go on being wrongly shown or hidden after the tag library changed. The context is also
warmed at load when the buttons are enabled at all, so the first one does not wait for it either.

`planEntities` walking its stages in sequence, one query per pass, is left alone throughout: it is
the shared planner, and §5c's guarantee that a button's visibility can never disagree with what a
click into the same entity would compute is worth more than the round trips.

**The lesson, and it is the same one the placement work learned twice:** three releases reasoned
about which cost to remove while nobody had measured which cost was there. The instrumentation that
answered it took one paste and no code change. Measure before the second fix, never after the
third.

**0.12.14 came from re-measuring after 0.12.13, and corrected 0.12.13's own conclusion.** With
`PTPTags` gone from the log entirely the button still took 1100 ms instead of 1230 - so the tag
query had been worth about 130 ms of *wall clock*, not the 766 ms its own duration suggested. The
second capture says why:

```
-> 1553ms  PTP_one_findScene  (650ms)   <- pass 1, while Stash's own five *ForSelect
-> 2204ms  PTP_one_findScene  ( 76ms)      queries for the edit form's dropdowns are
-> 2356ms  PTP_one_findScene  (138ms)      each taking 810-1096ms
*  2653ms  PTP2RE target button visible
```

The same pass measured 19 ms in the first capture and 650 ms in the second. Nothing about it
changed; what changed is that it no longer had `PTPTags` in front of it absorbing the wait, so it
ran head-on into the busiest instant of the page. **A duration is not a cost when requests contend -
removing the query in front only moves the waiting.** The real problem was never which queries the
probe makes but *when it starts*, and it started when `.edit-buttons` appeared: the moment the user
clicks Edit, which is also the moment Stash issues those five queries.

So `armExistenceCheck` is called before the container lookup as well as after. On a Scene the probe
runs while the user is still on the detail view and the answer is cached by the time the row exists;
opening the Edit tab draws the button with no request at all. Two consequences worth stating:

- **The dedup filter needs a container, so the early call arms on the unfiltered path set.** Dedup
  only drops a path when another plugin is *showing* a button for it, so in every other case the key
  matches what the filtered call would have produced and the cached answer stands. Where it does
  differ the probe re-arms, exactly as it did before.
- **A page view now costs a probe even if the user never opens the Edit tab.** That is the trade,
  and it is gated on `a1ShowManualButtons`: someone who has enabled the buttons wants them ready.

The source side is deliberately unchanged. Its container is the detail navbar, which is present on
load, so there is no later moment to move the probe ahead of - and the measurement showed both
plugins level on Performer detail, which is the floor for one round trip.

**The probe is asynchronous, which the target-side buttons never were before.** A button that was
showing a moment ago can vanish for one tick while a fresh probe runs after navigating to a
different entity or toggling a path's setting — there is no synchronous way to know existence
without the query. `manualButtonsTick` clears every button while a probe is `pending`, the same as
its other early-return branches (`!rt`, `!container`), so this reads as one more restraint rather
than a new code path.

**Naming (Improvement 3, rescoped): plain buttons, the user's own call, not the selection-menu
alternative.** The discussion enumerated both; the user chose "let's use buttons for now as
originally planned and done in MPT2S," splitting the menu idea out as its own deferred TODO instead
(Improvement 5, §8). Every path's `button` string moved to the convention agreed in that discussion:
`"Copy [all|common] [Tags|Perfs] [to|from] all <plural>"`. Two of thirteen carry a `{mode}` token —
`tags:scene>group` and `tags:subgroup>group`, the only two paths with a "common tags only" setting
— resolved by the new `buttonLabel(path, s)` at render time, so the caption always names whichever
mode is currently configured rather than freezing whatever it read on the first tick. `manualButtonsTick`
compares a rebuilt button's `_ptp2reLabel` (not its live `textContent`, which the click handler
overwrites with "Working..."/"Added N" mid-flash) against the freshly resolved label, so flipping
the mode setting while the page is open relabels the button without cutting a flash short.

**The source side (the rest of Improvement 3): a button on the source's own page, pushing outward,
mirroring `MergePerformerTagsToScenes`' performer button rather than a new mechanism.** Eleven of
the thirteen paths qualify — `SOURCE_BUTTON_LABELS` deliberately omits both marker paths, because a
`SceneMarker` has no detail page of its own to put a button on, unlike the other six source types
(Performer, Studio, and the four entities that are also targets). This is a placement gap, not an
oversight; §8's discussion flagged it and the user's decision did not ask it to be solved.

- **No staging.** A target-side button stages into *one* captured form control; a source button can
  resolve to dozens of different targets across dozens of different pages, and there is no single
  form to stage into. Every source button therefore ignores `a2SaveImmediately` — that setting is
  about which of the target buttons' two behaviours to use, and a button with only one behaviour is
  not addressed by it. Until 0.18.0 that one behaviour was writing on the spot; it is now the review
  dialog, scoped to the path and the source (§5h), which is the closest thing to staging a fan-out
  can have.
- **Reuses `SOURCE_REVERSE` (§4e) to resolve targets, not a new lookup.** `resolveSourceTargets(path,
  [id])` is the exact function a source-side *auto-mode* reaction already calls; a click plans and
  applies just `[path]` onto whatever it resolves, via `AutoRun.planEntities(path.target, [path],
  targetIds)` — narrower than `runAutoTargets`, which would replan *every* enabled path into that
  target and do more than the one button clicked promised.
- **Existence gating here needs no walk at all.** `checkSourceButtonExistence` calls
  `resolveSourceTargets` per candidate path and treats an empty id list as "hide" — the same lookup
  the click performs, so button and click can never disagree about what counts as nothing.
- **`findDetailContainer()` is the *other* half of the swap `findManualButtonContainer` already
  reads** — the `.details-edit` carrying a Delete button, which the target-side finder explicitly
  rejects. Confirmed live only for Group (that rejected half) and, through
  `MergePerformerTagsToScenes`' own precedent, for Performer. Studio, Scene, Gallery and Image are
  the same guess, unverified — the placement caveat that has applied to every page since 0.8.0
  applies again here, to six pages instead of four.
- **`SOURCE_ROUTES` adds `/performers/:id` and `/studios/:id`**, routes this plugin had no reason to
  recognise before a source could have its own button; the other four reuse `TARGETS[key].route`
  verbatim, since a source button and a target button for the same entity type live on the identical
  URL, just in different DOM states.
- **The dedup check (§5b's 0.8.3 two-signal design) applies unchanged.** `otherPluginDeclaresPath` +
  `foreignButtonAlreadyShows` are shared verbatim between `manualButtonsTick` and
  `manualSourceButtonsTick`, reading `sourceButtonLabel(p, s)` in place of `buttonLabel(p, s)`. This
  is *why* `MergePerformerTagsToScenes` 1.12.1 renamed its own two buttons in the same change: its
  Performer-page button covers the identical `tags:performer>scene` path this plugin's new
  Performer-page button does, and the dedup check only works because both plugins now say "Add Tags
  to all Scenes" for it — an unrenamed sibling would have shown both, the exact duplicate the whole
  mechanism exists to prevent.

## 5d. Where a manual button lands in the row

The mechanism is shared with `MergePerformerTagsToScenes` and documented in the repo-root CLAUDE.md;
this section is the map of this plugin's copy, and of the two decisions that are this plugin's alone.

**One anchor, both sides.** `insertBeforeImportantAction` searches `.delete`, then a text match on
`'Delete'`, then a text match on `'Save'`, walks up to whichever node is the container's own direct
child (`insertBefore` accepts only one), and appends when it finds none. Anchoring on Delete lands a
button *between* Save and Delete wherever both exist, which is the position live feedback settled on;
Group's edit form, the one page confirmed to render no Delete, reaches the Save fallback and so keeps
Stash's own primary action last. Target- and source-side buttons go through the identical call.

**`findActionByLabel` matches `<a>` as well as `<button>` and trims before comparing.** Stash styles
some row actions as links and pads their text, and being wrong about either costs a silent
misplacement. It is a plain recursive walk rather than `querySelectorAll`, which the shared test
harness's fake DOM does not implement.

**The container finders are deliberately *not* loosened to match.** `findManualButtonContainer` and
`findDetailContainer` use `button.delete` as a *discriminator* between a detail navbar and an edit
form, not as an anchor, and on the navbar the class is confirmed present. A text match there would
change which container is chosen — a much worse failure than a misplaced button.

**Row spacing** is `ensureRowSpacing` (a container-level `row-gap` where the container is flex, a
bottom margin on our own buttons where it is block) plus `applyButtonSpacing` (nothing where the
container already spaces its children with `column-gap`; the row's own step, filled against the real
neighbours, where a donor button exists; `mx-1` where neither). The four hard-won facts behind those
branches are in the header of this file.

**Ordering against the sibling: this plugin registers `coop().order` priority 10**, below
`MergePerformerTagsToScenes`' 20, so its buttons land on the far side of that plugin's rather than
racing it for the position next to the anchor. Every button carries `_coopOwner = PLUGIN_ID`.

**Not the same problem as the duplicate check.** `otherPluginDeclaresPath`/`foreignButtonAlreadyShows`
answer "is a button for this exact path already showing" and suppress one of two entirely; ordering
applies only once both plugins have decided to show buttons, necessarily for different paths, and
only decides which sits closer to the anchor. The two run independently.

**Four of the six source-button pages have no anchor, not one** (confirmed live 2026-08-12, by the
0.13.1 gating channel). `findDetailContainer()` wants a `.details-edit` carrying a Delete button —
the detail-view navbar — and **only Performer and Group render one.** Scene and Gallery render none
at all: their detail views show a tab strip (Details / File Info / Chapters / Edit) and no button
row, so `no detail button row on <entity>` is emitted with the Edit tab shut and stays true. Studio
and Image are still unconfirmed but are now more likely to match Scene/Gallery than Performer/Group.

Until 0.13.3 this was recorded here as "Gallery Details reportedly renders no buttons of its own",
one page and second-hand. **It was four pages, and the gating channel is what found them** — the
source buttons had simply never appeared on any of them and nothing said so. A silent gap on
two-thirds of the pages a feature covers is the case for the diagnostic in §5e, more than the
per-button reasons it was built for.

**0.14.0 is the second anchor, and the markup was read rather than guessed** — §6's rule, and the one
four releases of placement churn paid for. What a live Scene renders:

```html
<div class="scene-tabs order-xl-first order-last">     <!-- grandparent, flex -->
  <div>                                                 <!-- parent, block, 1 child -->
    <div class="mr-auto nav nav-tabs" role="tablist">   <!-- the strip, flex -->
      <div class="nav-item"><a data-rb-event-key="scene-details-panel">Details</a></div>
      … <a data-rb-event-key="scene-edit-panel">Edit</a>
```

`findSourceButtonContainer` is `findDetailContainer() || ensureTabStripRow()`, and the order is what
keeps Performer and Group exactly as they were: they render a navbar and no strip, so they never
reach the second branch.

**The strip is found by its Edit tab's key, never by its class.** Gallery renders *two* `.nav-tabs`
strips — its own panels, and an Images/Add strip for the image list — and only the entity's own
carries a `*-edit-panel` key; a class match picks whichever comes first. Scene independently renders
a second element whose text is exactly `Edit` (a `button.btn-link` in the details panel), so the
label match `findActionByLabel` uses would be ambiguous there too. The key is the only signal that is
unambiguous on both pages, and it says what it is. `hasEditPanelTab` is a hand-rolled walk for the
same reason `findActionByLabel` is one: the shared harness's fake DOM answers class selectors and
nothing else. A mutant matching by class alone fails exactly the two Gallery checks.

**The row is ours, and that makes it the simplest container in the plugin.** It goes immediately
after the strip inside the strip's block-level parent — not *inside* the strip, which is a
`role="tablist"` whose children are meant to be tabs and whose flex row would put a button on the tab
line. Stash puts nothing in our row, so there is no anchor to find and nothing to order against:
`insertBeforeImportantAction` recognises no action and appends, which is already its fallback, so
that call needed no branch. It spaces its own children with `column-gap`, which is the one case
`applyButtonSpacing` already knows to keep its hands off.

**0.14.0 showed it on every tab, and 0.15.0 stopped.** The strip is the tab selector, so a source
button anchored under it sat over Details, over File Info, and just above the target-side buttons on
Edit. Live feedback, and right: "Add Tags to all Groups from their Scenes" means something while you
are looking at the scene's groups and is noise everywhere else. `targetTabSelected(path)` matches the
open tab against the path's **target** type, so each button appears on the tab showing the things it
writes to. Performer and Group are unaffected — they have a navbar and no strip, and a page with no
strip is not gated by one.

**It fails open, and that direction is the whole design.** Three tab keys have been read off a live
Stash and the rest have not, so `targetTabSelected` returns `null` for "this page has no tab for that
type", which the caller reads as *show*. Hiding on an unrecognised key would be indistinguishable
from the bug 0.13.3 spent a release finding — a button silently absent with nothing saying why — and
§5c's recorded preference is a button sometimes unneeded over one missing when needed. A mutant
flipping `sel !== false` to `sel === true` fails six checks.

**The match is exact on the key's middle segment, and that part is defence, not a fix.** No fixture
can tell it from a substring test: the case it looks like it guards — a Group page, where every key
starts `group-` — has a substring matcher matching every tab, one always selected, answering "shown"
exactly as falling open does. What it actually buys is a future key that merely *contains* a target's
name (`scene-grouping-panel`) engaging the gate and letting it hide. **A mutant using `indexOf`
passes the entire suite**; that is recorded rather than hidden, because an earlier version of the
test claimed to catch it and did not.

**The click evicts what it wrote from Apollo** (`evictTargets`), so the panel listing those entities
redraws — the visible case is the tag counts on a Scene's Groups tab, rendered from cached `Group`
objects that nothing else would refresh short of a navigation. `TARGETS[].label` doubles as the
GraphQL typename, which is what Apollo keys normalised objects on. **Eviction only, never
`location.reload()`**, which is where this differs from `MergePerformerTagsToScenes`'
`refreshSceneData`: a reload is tolerable after its performer button, which moves the user anyway,
and here it would tear the page down mid-"Added 3". Where Apollo is absent the panel stays stale
until the user navigates. Only on a write — evicting after a no-op would refetch a panel nothing
changed.

**The labels name the real source, and the tooltip says the part no label can.** A source button does
not copy *this* entity's payload outward: it finds the targets this entity reaches and rebuilds each
of them from **all** of their own sources. For the two `{mode}` paths that is the difference between
something and nothing — a scene's tag is copied to its group only if every *other* scene in that
group carries it too — so 0.15.0 puts it in the caption, in the user's own wording:
`Add {mode} Tags to all Groups from their Scenes` and `Add {mode} Tags to all Containing Groups
from their Sub-groups`. The other nine keep their captions, because their extra sources only ever
*add* on top of what the user expected; `manualSourceButtonTitle` states the aggregation for all
eleven and names the common-mode consequence where it applies. Renaming these two is safe against
§5c's cross-plugin dedup contract, which only ever matches on `tags:performer>scene`.

**A studio with no tags of its own showed "Add Tags to all Scenes" until 0.13.0.** The source
button's gate asked only whether any *target* existed, never whether the source carried anything to
copy. §5e added the second half; the boundary that remains is one step further out — whether those
scenes already have the tags — and that one is unbounded, so it stays.


## 5e. Improvement 4: hide a button that would add nothing (0.13.0)

Deferred at 0.9.0, built here. Three parts, and the reason they landed together is that the first
one turned out to be free and the third is what makes the first two usable.

**The target side cost nothing, because the answer was already being computed and discarded.**
`checkButtonExistence` ran `AutoRun.planEntities(target, paths, [id])`, and `oneQuery`'s
`targetParts` carries the target's own `tags`/`performers` *and* every path's full walk down to its
payload leaf. So `planTarget` had already run the whole diff — `aggregate`, the common-tags fold,
the `existing` check, `filters.tagBlocked` — before deciding whether to create a plan entry. The
existence hook read `agg.n`, the weakest question available in that pass. `recordAddable` reads the
strongest, at no extra request, and `checkButtonExistence` became `probeButtons` returning both.
**Before adding a query to answer a question, check whether the pass in front of you already
answered it.** Three releases of latency work (§5c) went into what the probe costs, and the
strongest possible answer was sitting inside it the whole time.

**`recordAddable` fires ahead of `entry.has`, not after it.** The dedup there answers "did any path
in this plan already ask for this id", which is right for the plan and wrong for a button: two paths
that would each add the same tag are two buttons that would each do something, and reading
eligibility off the finished plan would hide the second. `propagate-buttons` pins both directions.

**The source side stops one step short, and the step it stops before is the unbounded one.**
`checkSourceButtonExistence` gained a second half: one by-id query for the source's own payload,
`sourcePayloadQuery` selecting the union of the page's paths' `leafSelection`s and `payloadOf`
reading each path's ids back out of it, minus anything `filters.tagBlocked` refuses. What it still
does not ask is whether the reachable targets already have those tags — that is reading every scene
a studio touches. So a source button can still report "No changes", and that is the ceiling rather
than a bug. `SOURCES` gained `one` (`findPerformer`/`findStudio`/`findSceneMarker`) for the three
source types that are not also targets; the other four already had it via `TARGETS`.

**The two halves write into maps of their own and are folded at the end.** They resolve in either
order, and a late `true` from the target lookup landing on the same key a payload miss had already
set to `false` would show a button whose source is empty. This was written the shared-map way first
and it is exactly the kind of race a test with deterministic responders does not catch.

**Dynamic refresh is what makes eligibility usable rather than annoying.** Both probe slots are keyed
on the entity and the path set, and a save changes neither — so a button decided before an edit kept
that answer until the user navigated away and back. Under *existence* gating that was survivable,
because the relationships it asked about rarely changed under an open page. Under eligibility it is
not: the commonest thing a user does on an Edit tab is change exactly what the gate reads.
`invalidateButtonProbes` drops both slots and re-ticks, from four places:

- **The `fetch` wrapper**, on a successful mutation naming the entity in view (`viewingOneOf`, which
  checks both route matchers, since `/scenes/7` is a target page and a source page at once). Its own
  branch, ahead of and independent of both reaction branches, and **unconditional on `a3`/`a4` and
  on `autoSuppressed()`** — a button appearing after a save is not something a user should have to
  enable auto mode to get. MPTTS' CLAUDE.md §3 states the same rule about its own equivalent branch,
  which is the older of the two.
- **`runAutoTargets`**, on a write, because an auto reaction writes *after* the save that triggered
  it — so the wrapper's invalidation would otherwise have been spent on a library our own reaction
  then moved again.
- **Both button clicks**, on the existing `FLASH_MS` timer rather than at once, so "Added 3" is not
  torn off the button mid-caption by the tick that removes it.
- **`invalidateAutoSettings`**, because a "common tags only" or filter toggle changes what a path
  would add without changing either the entity or the path set. A *path's* own toggle changes
  `pathIdsKey` and re-arms on its own; these do not.

The library-wide task writes thousands of mutations and reaches none of this: they all run inside
`guarded()`, which returns from the wrapper before any of it.

**The ceiling, stated rather than hidden: the gate reads the server, and a staged click reads the
form.** Remove a tag from the open form without saving and the button that would restore it stays
hidden. Gating against the captured form controls instead is possible and is deliberately not done —
it would couple button visibility to the `TagSelect`/`PerformerSelect` capture machinery, which
React re-renders on every keystroke, so the gate would re-evaluate constantly and flicker. Save is
what reconciles the two, and Save is what the invalidation above hangs off.

**And a switch to ask it why.** `coop().debugButtons` (0.13.1) turns on a `[ptp2re gate]` channel
naming, per button, whether it is shown or hidden and on which of the reasons above. The mechanism
is shared with `MergePerformerTagsToScenes` and documented in the repo-root CLAUDE.md; what is worth
noting here is *why it was worth building for gating specifically*. Existence gating had one reason
to hide and it was visible on the page — no performers listed, no studio shown. Eligibility has six,
and four of them are invisible: the sources' tags, the target's own tags, the common-tags fold and
the exclusion filters are not things a user can see by looking at the entity. An absent button went
from self-explanatory to unexplainable, and this is the answer.

The two hooks are what make the line specific: `has` and `adds` are both kept on `_existenceCheck`
purely so it can tell "there is no studio here" from "the studio's tags are already all on this
scene", and the source side keeps `reaches` and `carries` apart for the same reason. Both
distinctions are invisible from the button and each points at a different thing to go and fix.

**0.13.2 fixed it saying nothing at all in the commonest case.** Live paste, one day after 0.13.1:
the structural lines appeared (`5 enabled paths`, `button row found`) and not a single per-button
outcome. The outcomes were emitted from the probe's callback, and a probe runs once per entity — so
switching the flag on while already on the page produced no probe and therefore no outcome, which is
precisely how a debug flag gets switched on. They now come from the tick via `gateLogOnce`, keyed per
path with the entity in the text, so a cached answer states itself, a repeat is silent and a change
or a navigation speaks. The probe keeps one line of its own saying it ran. **A diagnostic that only
speaks when a cache misses is silent exactly when it is wanted** — and storing both halves of each
answer (§5e above) is what makes restating it possible without re-querying.

The same paste showed `manualSourceButtonsTick` reporting "no detail button row" on a Scene whose
Edit tab was open, for a page where no enabled path reads from a Scene at all. The container lookup
ran before the candidate-path filter, so it complained about nowhere to put a button that was never
going to exist. Only the *dedup* half of that filter needs a container, so the two are split now and
the cheap half runs first.

## 5f. Parity with `MergePerformerTagsToScenes` (0.16.0)

Both plugins run `tags:performer>scene` (§5a), which makes them comparable on that one path, and a
side-by-side reading found four places they disagreed. Three were this plugin's to fix; the fourth
was the sibling's, and it was fixed there in the same round (its 1.16.3). None of them is about
*what* gets copied — the copy itself was already the same — and that is why they went unnoticed:
every one is about what happens around the write.

**A target-side button ran every enabled path into the page, not the one that was clicked.**
`runManual` took `(target, id)` and planned `enabledPaths(s).filter(p => p.target === target)`, so
with the performer and studio paths both on, "Add all Tags from all Performers" copied the studio's
tags too. It now takes the path. **`runManualSource` had this right from the start and carries a
comment naming the hazard** — "not `runAutoTargets`' replan everything enabled for this target,
which would pull in *other* sources' paths too and do more than the button that was clicked
promised" — so this is not a case of nobody having thought about it. The reasoning was written down
on one side of a pair and never crossed to the other, which is the same failure §5c records about
citing a sibling's behaviour without checking whether it was argued for. **When you write a note
explaining why a function is narrow, check its twin.**

**Apollo eviction lived in one caller instead of at the write.** `evictTargets` was called from
`runManualSource` only, so both automatic modes wrote and left the page showing what Stash had read
before the save — the sibling refreshes after every one of its auto merges. It moved into
`AutoRun.apply`, which is the one function every headless write here passes through, and into the
task's `finishApply`/`finishUndo` for the dialog's two. It now evicts **what the server accepted**
rather than every target the run looked at, which is strictly narrower than what the source button
did before: that evicted every target a source *reached*, including ones it wrote nothing to. The
plugin already refused to evict at all after a zero-write click, so the old behaviour was
inconsistent with its own rule rather than merely coarse.

**Staging failed instead of degrading where `PluginApi` cannot be patched.** `stageEntry` throws
"open the Edit tab first", which is the right answer when the control is genuinely absent from an
open form — and the wrong one on a Stash that was never going to expose the patch point at all.
`_selectPatchesInstalled` records whether `installSelectPatches` succeeded, and a click falls back
to saving when it did not, warning once. The user did not opt into review; they opted into the
button. The tooltip reads the same expression, so it never promises a review this Stash cannot give.
The sibling has made this trade since it grew staging (`stagingActive`/`warnNoStagingOnce`).

**The recap's tags now hover**, naming aliases and description — the sibling's 1.8.0 feature, in
this plugin's own recap. Same four constraints and they are worth restating because they are what
keep it cheap: the line is rendered as **spans** (`log` takes an optional `parts`, `flush` builds a
span per segment, `lines` keeps the joined string because Copy log hands over text); only tags with
something to add beyond the caption carry a title, since nothing marks which ones hover; the detail
is **one query scoped to the ids the recap names**, never two fields on `tagQuery`, which would
carry a paragraph per tag for the whole library; and failure is silent, because this buys a tooltip
rather than a write. `pass` is captured across the wait for the same reason it is in the sibling — a
Rescan mid-flight must drop the recap rather than land it in the next pass's log.

**The performer half stays plain text**, and that is deliberate rather than unfinished: performers
carry no equivalent detail on the traversal, so a tooltip there would be a second query for a
hover. The sibling has no performer recap at all to compare against.

**What stayed different, and should.** The sibling shows `Merging... (12/340)` on its performer
button while this plugin's source button shows `Working...` — a real gap, left open on request. And
its per-scene writes against this plugin's bulk batching are not a discrepancy to close: the batches
are what let a run write tens of thousands of assignments in hundreds of requests.

## 5g. Colour (0.17.0)

Every button this plugin draws — target side and source side — is `btn-warning` rather than
`btn-secondary`, and so is the task button `paintTaskButtons` repaints on the Plugin Tasks page.
Four settings toggles are recoloured to match: `a2SaveImmediately` and the two auto modes in amber,
`g1LogToConsole` in teal. **The review dialog's Proceed and Undo joined them at 2.4.0** - the two
buttons in that footer that write, where Cancel, Stop, Copy log, Rescan and Close do not. The
reasoning, the two live facts about Stash's theme it rests on, and why the variant is pinned to the
same string in the sibling are in the repo-root CLAUDE.md under *one colour for "a plugin wrote
this"*.

Placement is unchanged. §5d's important-vs-casual rule still decides *where* a button lands, and the
ordering protocol still decides which of two plugins' buttons sits closer to Delete — amber is a
casual button in a new colour, not a claim on the row's primary role.

`paintTaskButtons` reuses `ownTaskName` rather than matching the label a second time, which keeps
the paint and the click interception from ever disagreeing about what is ours. That function gained
a real fix at the same version — it now answers from the button's own `.setting-group` and stops,
where it used to climb past it into the panel holding every plugin's group and match whichever
plugin was listed first. See §2 of `NormalizeParentTags`' CLAUDE.md for the full note; all three
plugins carried it and all three were fixed together.

## 5h. No unreviewed write: the buttons open the dialog, scoped (0.18.0)

The repo-root CLAUDE.md states the rule; this is this plugin's half. Two of the three ways to write
here already asked first (the task's dialog, staging into the form) and the remaining two did not: a
target-side button with "save immediately" on, and *every* source-side button — the widest write in
the plugin, one click on a studio rewriting every scene it owns.

**`Run` gained a `scope`, and nothing else about it changed.** `{ pathId, target, ids }` for a
target-side click, `{ pathId, sourceId }` for a source-side one. `begin()` reads `scopedPaths` in
place of `enabledPaths` — one path, re-read from the settings so a path switched off between the
tick and the click is refused — and calls `scanScoped` in place of `scan`. Everything downstream
(the batches, Proceed, Undo, Rescan, the recap, the lease, `guarded()`) is what the task runs.

**`scanScoped` plans through `planPass`, borrowed *back* from `AutoRun`.** That is the one structural
addition: `AutoRun` has always borrowed the planner from `Run`, and now `Run` borrows the two methods
that drive a *named* set of entities from `AutoRun` — assigned after their definitions, since
`AutoRun`'s own borrow list runs before them. So a scoped dialog and an auto reaction plan through
identical code, which is what makes "the dialog shows what the click would have written" true by
construction rather than by inspection. `scan` was split into `prepare` (the tag map and the
filters, which both need) and the library walk.

**A source-side scope resolves its ids in the dialog, not before it.** `scopeIds` calls the same
`resolveSourceTargets` the click used to call, so the review covers exactly the entities the write
would have covered, and the user sees the dialog open immediately rather than after a lookup.

**`runManualSource` no longer writes at all**, and `runManual` writes only through staging. Both
return `{ mode: 'dialog' }`, which is the click handler's signal to restore the caption instead of
flashing a count under a modal that covers it.

**Re-probing moved to `Run.close`.** Both clicks used to invalidate the eligibility probes on the
flash timer; a dialog's writes land long after that, and the buttons are unreachable while it is
open, so the close is the first moment a re-probe is worth anything. On a page with no manual
buttons the tick returns before it queries anything.

**The captions.** `withEllipsis` appends "..." where the click opens the dialog: always on the
source side, and on the target side per `savesImmediately(s)` — one expression now shared by the
caption, the tooltip and `runManual`, so they cannot disagree. `sameButtonLabel` strips trailing dots
before the cross-plugin dedup compares, because the sibling appends its own on its own conditions
and one plugin staging while the other reviews must not read as two different buttons.

**The title (0.18.1), which 0.18.0 shipped as a sentence made of three unhelpful parts.** It read
`Propagate Tags and Performers to Related Entities - Add Tags to all Scenes... - Group 57`. Three
fixes, one per part:

- **The "..." comes back off.** It is a promise a *caption* makes — "this click asks before it acts"
  — and the caption is being quoted inside a sentence here, where trailing dots are just punctuation
  in the middle of one. `stripEllipsis` is the shared half of `sameButtonLabel`, which was already
  doing this for the dedup comparison.
- **`PLUGIN_SHORT_NAME`, beside the manifest's `PLUGIN_NAME`.** The full name cannot change:
  `ownSettingGroup` finds this plugin's block on the settings page by matching that heading against
  the `.yml`. But as the first third of a title that goes on to name a task, a path and an entity, it
  is the longest third and the least informative — the user knows which plugin they clicked. Every
  other use of `PLUGIN_NAME` stays, including the console prefix, which is where a line detached from
  a dialog needs the unabbreviated name.
- **`scopeLabel(type, id)` names the entity**, in `entityLabel`'s shape — `Performer "Jane" (100)` —
  keyed off `SOURCES` first so all seven types resolve without a branch. It costs one by-id query per
  scoped click, made while a dialog opens on a scan about to make dozens, and falls back to the bare
  label and id rather than rejecting: a dialog that cannot name its scope should still open.

The two scoped call sites read `- from <entity>` on the source side and `- for <entity>` on the
target side, which is the direction the copy runs in each case. **The title wraps rather than being
clipped** when all of that exceeds a line: `.ptp2re-title` is a plain block and nothing in `CSS`
makes it a flex child or sets `white-space`, so this is the default holding rather than a rule — but
it is now a default worth not breaking.

## 5i. Copy became Add (2.2.0)

Every manual button here said **Copy** — `Copy all Tags from all Performers`, and twenty-odd more between this plugin and its
sibling. That was unambiguous while these two were the only plugins in the repo that moved tags.
`TagBundleClipboard` made it ambiguous: it has a real clipboard, and a row could end up carrying two
buttons both saying "Copy" and meaning different things.

They all say **Add** now, in the same release as the sibling's, so the cross-plugin dedup — which
compares two plugins' live button *text* — still matches. `Copy log` in the footer is untouched: it
copies to the system clipboard, which is what the word means outside this repo.

Minor, not major: nothing matches on these strings except that dedup, and both sides moved together.
The major digit is for a rename users have to act on, which is what `ownSettingGroup` and
`ownTaskName` matching on the plugin **name** made the `ᝯㄝₓ ` prefix. The full reasoning, including
why `Add` beat Import/Export and Propagate, is in the repo-root `CLAUDE.md` under "One verb per idea".

## 6. Anchoring in Stash's markup

Every foothold here is a guess until it runs against a real Stash, and a test written from the same
guess confirms nothing. Both siblings shipped broken twice on heading text; the rules that came out
of it apply unchanged:

- **Find our settings group by the `plugin-<id>-<key>` element ids**, never by heading text.
  `SettingsPluginsPanel.tsx` builds them from the plugin id and the setting key, so they are ours by
  construction. `ownSettingGroup()` tries every key in `DEFAULTS` rather than two named ones, so
  removing a setting cannot quietly break the anchor.
- **...and it falls back to the heading's group when not one id is on the page** (2.3.1). Trying
  every key survives one rename; it does not survive a release that renames them all, and that is
  not hypothetical — `NormalizeParentTags` 4.0.0 renamed all nine of its keys, and the 3.2.0 script
  still running in every un-reloaded tab could not find its own group, so the **stale-script
  banner** never appeared on the one release that needed it. A diagnostic reachable only through
  something a release can rename is silent exactly when it matters.
- **The fallback excludes the Tasks page**, which heads *its* group with the same plugin name.
  `hasOwnTaskButton` is the discriminator: the heading says who we are, the buttons say which page.
  It is not cosmetic — `readmeLinkSlot` picks its slot by structure, and in a tasks group that slot
  is *inside the task button*, so the link becomes the button's only child and the label
  `ownTaskName` matches on is gone: no interception, no amber, a click queueing a server-side job
  for a plugin with nothing to execute. Both halves are pinned in `propagate-base`, including that
  the button is still repainted.
- **`headingIsOurs` strips the version suffix and compares exactly.** Settings → Tasks passes the
  name through; Settings → Plugins appends `(0.1.0)`, and interpolates the literal `undefined` when
  a plugin has no version. A prefix test would match a plugin whose name merely starts with ours.
- **Everything injected is re-added, not tracked.** React re-renders the panel on every settings
  change and drops it; the tick puts it back, and an id keeps that from producing a second one.
- **No MutationObserver on the settings page.** This is decoration, not something that must land
  before the user can click it, so the timer plus the navigation hooks are enough and cannot fight a
  re-render.

## 7. Testing

`node tests/run.js`. Nine suites touch this plugin so far:

- **`propagate-paths.test.js`** — the tables, and the invariants the order carries. See
  `tests/README.md`.
- **`propagate-modes.test.js`** — the `b1Paths` string (3.0.0): the parser and the formatter read
  straight off the plugin's exports, migration from the fifteen booleans it replaced, the Path
  Settings dialog, and the settings row it takes over. The parser cases are deliberately *not* read
  back through a run, unlike the sibling's equivalent suite: what a run does with the answer is
  already covered eight ways over, and the value is the thing this release is about.
- **`propagate-base.test.js`** — both layers of task interception, the dialog head, the
  configuration review, the version gate, the lease warning, the footer, and the settings-page
  injection. Since 0.7.0 also §5a: publishing enabled paths into `coop().declares` (including an
  empty list with nothing enabled), another plugin declaring an overlapping path noted in the log
  and a non-overlapping one staying silent, and the NormalizeParentTags check's four outcomes
  (registered, unregistered, both modes cancelling out, not installed) ported from the sibling's own
  suite.
- **`propagate-plan.test.js`** — the walk over the library: the gather, the diff, both aggregation
  modes and their edges, the cascade, every exclusion filter, pass ordering, naming, the recap, and
  that a review issues no mutation at all. Since 0.16.0 the recap's tooltips (§5f): the detail query
  scoped to the ids the recap names and asking for the two fields `PTPTags` deliberately does not, a
  tag with aliases and a description hovering to both, a tag with neither left plain, the spans
  carrying a title and no class, the line unchanged as text so Copy log is unaffected, and a failed
  detail query leaving the recap readable and unremarked.
- **`propagate-sweep.test.js`** — the two reverse paths and the sweep that gathers them: what it
  costs, that an image in two galleries reaches both, that it pages and accumulates, that every
  source is gathered before any target is read, a partial sweep after a failed page, and the
  progress line read *during* the sweep rather than after it.
- **`propagate-apply.test.js`** — phase 2 and Undo: delta writes, batching, failed batches isolated,
  Stop, Rescan, the leases, the arm/confirm latch, and that phase 2 reads nothing. Since 1.2.0 the
  Rescan case pins what it *keeps* rather than what it cleared — the rendered log growing across the
  `--- Rescan ---` marker with the earlier pass's `[INFO] Applying` line still on screen — plus the
  button's new tooltip; all three fail against 1.1.4. It takes about
  nine seconds, four of which are spent waiting out `UNDO_ARM_MS` to prove an expired arm does not
  write. That wait is the check; do not shorten it by reaching into the constant.
- **`propagate-auto.test.js`** — auto mode, target side (§4d): it reacts and writes an ADD delta;
  restraint around the mode being off, no matching path, a rejected save, a deleted entity; that the
  reaction never reacts to its own write; the per-entity cooldown, keyed and marked correctly; the
  lease, honoured and released; bulk saves; the settings cache and its TTL; the exclusion filters;
  and a reverse path reacting without sweeping the library. Since 0.16.0 (§5f), that a reaction
  evicts what it wrote from Apollo and collects afterwards, paired with the negative that a reaction
  writing nothing evicts nothing.
- **`propagate-auto-source.test.js`** — auto mode, source side (§4e): both lookup kinds, including a
  two-hop `field` and a two-hop `filter`; that every `PATHS` entry has a `SOURCE_REVERSE` entry; the
  same restraint suite as the target side, reused rather than re-derived because `runAutoTargets` is
  the same code; a bulk save deduplicating across sources; and that a save which is both a target and
  a source runs both reactions.
- **`propagate-buttons.test.js`** — manual buttons and staging (§5b): a button per enabled path
  labelled from `path.button`; restraint (the master toggle off, no path enabled, a path into
  another target, off any of the four pages, no `.edit-buttons` found); multiple enabled paths
  producing multiple buttons; staging pushing into a captured `TagSelect`, diffed against the form
  so a second click reports no changes; save-immediately issuing a bulk `ADD` delta instead; a
  missing captured control surfacing as an alert rather than a silent no-op; reconciliation not
  duplicating a button on an idle tick and replacing a stale one after navigating to a different
  entity; and the route matcher against all four page shapes plus an unrelated route. Since 0.8.1,
  a dedicated `nodeListLikeContainer` reproduces a real `NodeList`'s missing `Array.prototype`
  methods, since the shared harness's own container cannot - its `childNodes` is a genuine array.
  The `.details-edit` fallback in all four directions: used when `.edit-buttons` is absent, the
  detail-view instance (carrying Delete) skipped, the edit-form instance still chosen when both are
  present, and `.edit-buttons` winning outright when both containers exist. The duplicate-button
  check in all four directions - a foreign button for the same declared path suppresses ours, a
  declared-but-not-shown path does not, a foreign button for a different path leaves an unrelated one
  alone, and our own already-rendered button is never mistaken for a foreign one on a later tick.
  Eligibility gating (§5e): an absent source hides the button, a source with nothing *new* to add
  hides it too, two paths that would each add the same tag both showing, an empty common-tags
  intersection hiding one, two paths on one page gated independently, a failed probe falling back to
  showing rather than hiding, and the studio-with-scenes-but-no-tags scenario named explicitly. The
  labels, including the two `{mode}`-dependent ones. The whole source-side half - placement on the
  performer and studio detail views, gating via `resolveSourceTargets` and the payload query, a click resolving
  and writing directly with no staging option, the dedup check extended to it, and both route
  matchers. And placement (§5d): the button landing between Save and Delete rather than before Save
  or after Delete, a Delete nested in a wrapper still found, the Group-shaped no-Delete container
  falling back to before Save with Save left last, two enabled paths landing in their own order,
  `my-1` asserted *absent* from both button builders, the container carrying `row-gap: .25rem` after
  either tick touches it, `coop().order` registered at 10, and both ordering directions - a
  higher-priority foreign button not displaced with ours landing on its far side, and a
  lower-priority one staying put while ours lands adjacent to the anchor - on both the target and
  source sides. `tests/npt-harness.js` gained `previousSibling` for that last pair; without it every
  ordering check passed for the wrong reason regardless of which priority actually won. The
  placement fixtures are deliberately untidy - a class-less `<a>` Delete with padded label text -
  because a tidier one would pass against the unfixed source. Since 0.12.11, the probe's cost: a
  second probe within the settings TTL reuses the cached tag context instead of re-asking for the
  whole library (it fails against the pre-0.12.11 source, which asked twice), and two source paths on
  one page are still gated independently now that their lookups run in parallel. Since 0.12.12: a
  lapsed settings TTL no longer holds a button back — the clock is shifted and the settings query made
  to hang from that point, so a tick that still draws the *new* entity's button is the only thing
  separating the two behaviours — and the probe stops at the first page that found a target, paired
  with the negative that a page which yielded *nothing* still pages on. Since 0.12.13: the tag context
  outliving the settings TTL (the clock shifted past ten seconds, still one query) and being warmed
  at load before any container exists, with the negative that a user who has the buttons switched
  off is never asked for the tag library at all. Since 0.12.14: the probe running with no container
  present at all, and the button then drawn from the cached answer when the row appears without a
  single new query. Since 0.16.0 (§5f): two enabled paths drawing two buttons and the performer one
  writing *only* the performer's tag; a Stash with no `PluginApi` at all (`noPluginApi`, which is
  why `start` builds the fake conditionally) saving rather than alerting, with the tooltip promising
  the save; and the source-button eviction narrowed to what was written, via an `entity` responder
  that can answer per id — the flat form served one object for every id, so the old check was
  asserting that an *unwritten* group is evicted.
- **`style.test.js`** — the CSS this plugin shares with its three siblings.

**Every check here was confirmed against a deliberately broken copy before being trusted.** The
0.9.0 through 0.12.0 additions were confirmed the coarser way, against the pre-fix source via `SRC=`,
rather than one hand-built mutant per check; the pre-existing suites below that line follow the
finer-grained convention - sixty-four mutants so far, each failing exactly the check written for
it - a suite that passes for the wrong reason is worse than no suite. Use
`SRC=/path/to/mutant.js node tests/propagate-base.test.js`.

What they cannot cover: Stash's own behaviour. The suites reproduce its markup and its schema from
notes, so they prove the plugin does the right thing with what it is given, not that Stash still
gives it that. Anything touching §6 needs a click in a real instance before it is believed.
