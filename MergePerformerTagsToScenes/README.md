# Merge Performer Tags To Scenes

> ## ⚠ Back up your database before the first library-wide run
>
> The task below adds tags to potentially **every scene in your library** in one go, and **Stash
> has no undo**. Merging only ever adds, so it cannot strip a tagging scheme the way a bad prune
> can — but a merge you did not mean is thousands of scenes carrying tags you now have to find and
> remove, and there is no practical way to do that by hand. Stop Stash, copy `stash-go.sqlite`
> (next to your `config.yml`) somewhere safe, start Stash again — then run the task. Read the
> review log properly the first time; that is what it is for.
>
> The dialog does have an **[Undo](#undoing-a-run)** button, but it only reaches its own writes and
> only while it stays open. It is a way out of a run you regret in the moment, not a safety net —
> the backup is the safety net.
>
> The two **auto-merge** settings deserve the same caution for a different reason: they write on
> every save, with no dialog and nothing to undo them. The manual buttons are the safe way to try
> this plugin out.

> **Requires Stash 0.31.0 or newer.** Tag custom fields (the custom-field exclusion filter) and UI plugin component patching (staging tags in the scene edit form) both depend on it.
>
> **This plugin has not had a long life in other people's libraries.** It has automated tests
> behind it, but that is not the same thing — which is another reason to take the backup above
> and to read the review log before pressing Proceed.

> **Upgrading to 1.1.1 from an earlier version resets the plugin's settings.** The settings were
> renamed internally so that the settings page lists them in a sensible order instead of
> alphabetically. Nothing else changed, but your previous choices are not carried over — open
> **Settings → Plugins → Merge Performer Tags To Scenes** and set them again. Everything is off
> until you do, so nothing merges by itself in the meantime.

A front-end-only Stash plugin that adds two tag-merging buttons:

- **"Copy Tags to all Scenes"** on each performer's detail view — copies that performer's tags onto every scene featuring them, regardless of any filter or selection in the scene list below.
- **"Copy all Tags from all Performers"** on each scene's Edit tab — puts all tags from all of that scene's performers into the scene's tag box for you to review and save (or saves them directly, if you enable **Save Tags Immediately**).

Buttons are hidden by default and can be enabled in **Settings → Plugins → Merge Performer Tags To Scenes** via the **Show Manual Merge Buttons** toggle. When enabled, each button only appears when there is something to act on: the performer button needs the performer to have both tags and scenes, and the scene button needs the scene to have performers. Tags are **added** (not replaced) — existing tags are always kept.

There is also a **library-wide task**, in **Settings → Tasks → Plugin Tasks**:

- **Merge Performer Tags into All Their Scenes** — does what the performer button does, for every
  performer in your library, in one run. It works in two phases, like Normalize Parent Tags:

  **Review.** Clicking the task opens a dialog and scans the library without writing anything. It
  lists every tag it would add to every scene, names the performer each one comes from, and shows
  which exclusion filters are active. **Proceed** stays disabled until the scan finishes, and stays
  disabled if there is nothing to do. **Cancel** walks away with your library untouched.

  **Apply.** **Proceed** performs the merge and continues the log with what was actually written.
  **Stop** halts after the current scene — what has already been written stays written. **Copy log**
  hands you the whole run, **Rescan** starts a fresh review without closing the dialog, and
  **Undo** takes the merge back — see [Undoing a run](#undoing-a-run).

  A scene featuring several performers is written **once**, with the tags all of them contribute.

  Each phase ends with a one-line recap of **every distinct tag involved** and how many scenes it
  lands on — what the plan would add, and then what was actually added:

  ```
  [INFO] 3 tag(s) to add: "Blonde" (12) x250, "Tattoo" (17) x18
  ```

  The tags are listed in the same order Stash sorts them — by **Sort Name** where a tag has one,
  otherwise by name, ignoring case and treating numbers as numbers.

  **Hovering a tag in that line** shows what it is — its aliases and its description:

  ```
  Blonde
  Stash tag id 12
  Aliases: Blond, Blonde Hair, and 2 more
  Description: Natural or dyed light hair…
  ```

  Only the tags that have aliases or a description hover at all; the rest have nothing to add
  beyond the name and id already on the line. Long alias lists and long descriptions are
  shortened — the aliases say how many more there are — so the tooltip cannot bury the log. This
  costs one extra query per phase, for the handful of tags the recap names rather than for every
  tag met while scanning, and if it fails the recap simply reads as it always did.

  **The number in brackets after a name is that scene's, performer's or tag's Stash id**, never a
  count and never part of the name — `"Blonde" (12)` is the tag with id 12, the one at `/tags/12`,
  which is also how two tags with the same name are told apart. The id sits *outside* the quotes so
  that a scene genuinely titled `My Scene (2)` cannot be misread as an id. Counts are written
  differently: `x250` above means 250 scenes. The dialog repeats this in a line under its warning.

  The task needs no settings turned on: the buttons and auto-merge modes are separate, and it runs
  whether or not they are enabled. The merge only ever adds tags, and **Undo** takes back what it
  added — but only while the dialog is open, so back up your database before the first run.

  Reviewing costs roughly the same time as merging, so a first run over a large library takes about
  twice as long as it would with no review. That is the trade for seeing the plan first.

Two optional auto-merge modes can also be enabled in the same settings panel:

- **Auto Merge On Scene Updates** — whenever a scene is saved, its performer tags are merged in automatically.
- **Auto Merge On Performer Updates** — whenever a performer is saved, their tags are merged into all of their scenes automatically.

Whichever way tags get merged, every merge can optionally be logged to your browser's JavaScript console (F12 → Console) — see [Logging merges to the browser console](#logging-merges-to-the-browser-console). Being a UI plugin, it cannot write to the Stash server log or the **Settings → Logs** page.

## Undoing a run

Once the library-wide task has written something, an **Undo** button appears in its dialog. It
removes the tags the dialog added, from the scenes it added them to, and covers the whole session —
a run you applied, rescanned and applied again comes back in one go.

The first click arms it and shows the scope (*"Undo 3 scene(s)?"*); a second click within a few
seconds carries it out. Clicking anything else, or waiting, disarms it.

**This is the only thing in the plugin that removes a tag**, and it is deliberately narrow: it
takes off exactly the tags this dialog put on, as a remove-these-tags instruction rather than by
rewriting each scene's tag list, so a tag you added yourself in the meantime is never caught up in
it. Three limits to know before relying on it:

- **It only lives as long as the dialog.** Close it, navigate away, or reload the page and the
  record is gone.
- **It only knows about its own writes.** Nothing else on those scenes is touched.
- **It cannot see what happened in the meantime.** If auto-merge, another tab or a second run
  re-added one of the same tags, Undo still removes it.

Everything else in the plugin — the two buttons and both auto-merge modes — only ever adds tags,
and none of them has an undo. Back up your database before a first library-wide run.

## Review before saving in Scene Edit tab manual merge

**"Copy all Tags from all Performers"** stops short of saving by default. The performer tags are dropped into the scene's own tag box, Stash's **Save** button lights up, and nothing is written until you press it. You can remove any tag you don't want first, and Cancel discards the lot.

Because nothing is saved, there is also no refresh and no jump back to the Edit tab — the tags simply appear in the box you're already looking at. The button reports what it did without changing width: *"Added 2"* then *"Save pending"*, or *"No changes"*, or *"Scene excluded"*.

Enable **Save Tags Immediately** in the plugin settings panel if you would rather it merge and save in one step, instead of the staging mode.

This setting only affects the scene page button. The performer button and both auto-merge modes always save directly, since they act on scenes whose edit forms aren't open.

Additionally, if the staging mode fails, the button merges and saves instead and logs the reason to the browser console — there is nothing to review on a Stash that cannot show you the staged tags. This could happen in the event of a breaking change in the way Stash handles the tag edit control for example.

## Exclusion filters

Four optional exclusion filters in settings let you protect certain scenes or tags from being touched:

- **Exclude Scenes with specified Tag** — enter a tag name; any scene carrying that tag is skipped. The tag is looked up by exact name and the result is re-checked periodically, so creating, deleting or recreating the tag is picked up without a page reload (a warning is logged to the browser console whenever the tag cannot be found). The exclusion tag itself is never copied into a scene, even if one of the performers carries it.
- **Exclude Scenes marked as organized** — scenes with the "organized" flag set are skipped entirely.
- **Exclude Tags set to Ignore auto tag** — performer tags that have "Ignore auto tag" enabled in their tag settings are not copied into scenes.
- **Exclude Tags marked via a Custom Field** — enter a custom field name; performer tags carrying that custom field are not copied into scenes. **Only the presence of the field matters** — the value is never looked at, so any value at all (including a blank one) excludes the tag. To have a tag merged again, remove the field from it rather than trying to set it to something falsy.

## Logging merges to the browser console

Enable **Log Tag merges to the Browser Console (Info level)** to have every tag the plugin adds reported, one line per tag and scene, at `info` level:

```
[MergePerformerTagsToScenes] Tag "Blonde" (12) saved to Scene "My Scene" (345)
[MergePerformerTagsToScenes] Tag "Tattoo" (17) staged to Scene "My Scene" (345)
```

**The number in brackets after each name is that tag's or scene's Stash id** — `"Blonde" (12)` is the tag at `/tags/12` and `"My Scene" (345)` the scene at `/scenes/345`. It is not a count, and it is not part of the name: the id is deliberately outside the quotes, so a scene actually titled `My Scene (2)` reads as `"My Scene (2)" (345)` rather than ambiguously. Use it to open exactly the scene or tag a line is about, and to tell two same-named tags apart.

**These lines go to your browser's own JavaScript console — not to Stash.** Open it with **F12** (or Ctrl+Shift+J / Cmd+Option+J) and pick the **Console** tab. This plugin runs entirely in the browser, so it has no way to write to the Stash server console or the **Settings → Logs** page; nothing will ever appear in either of those.

As soon as the plugin picks the setting up it says so once, so you can tell it is running before anything has been merged:

```
[MergePerformerTagsToScenes] merge logging enabled — one line will appear here per tag merged into a scene. The number in brackets after a name is that tag's or scene's Stash id.
```

If you tick the setting and that line never appears, check in this order: you are looking at the browser's console rather than the Stash log; the console's level filter is not hiding **Info** messages (Chrome collapses them under "Verbose"/"Info" in the level dropdown); and the browser is not still running an older copy of the plugin's JavaScript — the version line the plugin logs at load says which one it is, and reloading the page (F5) picks up a newly copied file.

The action tells you where the tag went:

- **saved** — the tag was written to the scene. This covers the performer-page button, both auto-merge modes, and the scene button when **Save Tags Immediately** is on.
- **staged** — the tag was only put into the open edit form's tag box, and is not saved until you press Stash's **Save** button. The line is written the moment the tag lands in the box, so if you then remove it or press Cancel it has already been logged — "staged" means exactly that, and nothing more.

Only tags that actually changed something are logged: a tag the scene already carried, a scene skipped by an exclusion filter, and a scene whose update failed all produce no line (failures are reported separately as errors). A merge that had nothing to do is therefore silent — which is why the banner above exists. Scenes without a title are named by their file name.

This setting is independent of everything else — it does not change what gets merged, only what is reported. The extra fields the log line needs (tag names, scene titles) are requested from Stash only while it is enabled.

## Installation

0. Check your Stash version is **0.31.0 or newer** (**Settings → System**, or the version in the footer). Older versions are not supported.
1. Find your Stash plugins directory. This is the `plugins` folder inside the directory that holds your `config.yml` (the same place as your Stash database, typically shown at the top of **Settings → System**). If no `plugins` folder exists yet, create one.
2. Copy the whole `MergePerformerTagsToScenes` folder into that `plugins` folder:
   ```
   <stash-config-dir>/plugins/MergePerformerTagsToScenes/MergePerformerTagsToScenes.yml
   <stash-config-dir>/plugins/MergePerformerTagsToScenes/MergePerformerTagsToScenes.js
   <stash-config-dir>/plugins/MergePerformerTagsToScenes/manifest
   <stash-config-dir>/plugins/MergePerformerTagsToScenes/README.md
   ```
3. In Stash, go to **Settings → Plugins** and click **Reload plugins** (or restart Stash).
4. If using multiple browser instances, refresh your browser (F5) so the new plugin JavaScript is loaded in all of them.

## Usage

The two buttons appear in different places, because each one sits where the content it acts on is visible.

**Performer page** — enable **Show Manual Merge Buttons** in settings, then open any performer's page. If they have at least one tag and at least one scene, an **"Copy Tags to all Scenes"** button appears in the button bar on the detail view, just before the Delete button. Click it to copy the performer's tags to all their scenes. Scenes already having all the tags are skipped, and the button counts through the scenes as it goes.

**The scene list's filter does not narrow this.** The button asks the server for every scene featuring the performer, so searching, filtering or ticking scenes in the Scenes tab below has no effect on which scenes are updated — narrow the list to three scenes and all of them are still merged. Use the scene page's "Copy all Tags from all Performers" button if you want to act on one scene at a time. The button is deliberately hidden while the performer's edit form is open, since the scene list is not on screen there.

**Scene page** — enable **Show Manual Merge Buttons** in settings, then open a scene and switch to the **Edit** tab. If it has at least one performer, an **"Copy all Tags from all Performers"** button appears in the button bar, just before the Save/Delete buttons of the edit form. Click it to add all tags from all performers in that scene into the scene's tag list.

### The README link in settings

**Settings → Plugins → Merge Performer Tags To Scenes** carries a link to this file, in two forms: the chain icon Stash puts in the header row, and a labelled `MergePerformerTagsToScenes/README.md` link the plugin adds underneath the description, since the icon alone is easy to miss. Both open the same page.

### Checking which version is actually running

**Reload plugins cannot replace the script your browser is already running.** It re-reads the plugin folder on the server; the JavaScript in your open page was fetched and executed when the page loaded, and stays until the page reloads. An update always needs a page reload — but a plain **F5** is normally enough, since Stash serves plugin scripts so that a normal reload picks up a changed file. Keep **Ctrl+Shift+R** (**Cmd+Shift+R**) for the case where it does not.

The version beside the plugin's name in **Settings → Plugins** does not settle it — that comes from the manifest, which is current the instant you reload plugins even when the running script is older. New version in the heading with old behaviour on screen is exactly what a cached script looks like.

So the plugin says which script is running, in the browser console (**F12** → Console) on every page load, whether or not merge logging is enabled:

```
[cpt2s] MergePerformerTagsToScenes.js 1.9.1 loaded. This is the running script's own version — the settings page reads the manifest instead, which can be newer than the script your browser has cached.
```

If that is not the version you just installed, the page is running an old copy. In order: reload (F5); check the new `.js` really is in `<stash-config-dir>/plugins/`, since a file that was never copied cannot be refreshed into existence; then hard-refresh; then, if it still will not budge, open DevTools → **Network**, tick **Disable cache**, and reload with DevTools open.

**The task checks this for you.** Opening the library-wide task asks Stash which version is installed and compares it with the running script. If they differ the dialog says so at the top and **Proceed stays disabled** until you reload the page. An unknown answer — an older Stash, a failed request — blocks nothing; only a definite mismatch does. It cannot catch an edit made without changing the version, since both numbers stay equal.


## How it works

This plugin is pure client-side JavaScript (`ui.javascript` in the manifest, no backend task). It calls Stash's `/graphql` endpoint directly from the browser using your existing logged-in session — no server-side plugin task or Python runtime required.

Three details that explain behaviour you might otherwise read as a bug:

- The performer button, and auto-merge on performer update, process a performer's scenes **one at
  a time** rather than all at once, to avoid hammering the server. A performer with many scenes
  takes a noticeable moment. If one scene fails the rest still run, and the failures are summarised
  at the end (details go to the browser console).
- Staging works by observing Stash's tag control through the UI plugin API. The plugin picks the
  most recently rendered control whose contents match what it expects the scene's tag box to hold —
  the scene's saved tags to begin with, then whatever it last staged there. If it cannot identify a
  control it reports an error rather than writing tags into the wrong one.
- Stash uses the same container class for the performer detail view's Edit/Delete bar and for the
  performer edit form, so the plugin identifies the detail view by its Delete button. If a future
  Stash release changes that markup the performer button will simply not appear, rather than
  showing up in the wrong place.

## Notes / limitations

- **Read carefully:** [⚠ Back up your database before the first library-wide run](#-back-up-your-database-before-the-first-library-wide-run)
- **The performer button**
  - Its eligibility (does the performer have tags and scenes) is only re-checked when the performer is saved or when you navigate to a different performer, not on every tick — so it stays correct without a page reload after you add tags to a previously tag-less performer, but a change made from elsewhere (bulk tag edit, another tab) is not noticed until one of those events happens.
  - It always covers **every scene featuring the performer**, as does auto-merge on performer update. Neither reads the scene list's filter or selection — the scenes come from a server query keyed only on the performer, so the plugin never sees what the list is showing. Only the exclusion filters narrow it.
- **Exclusion filters**
  - They apply to both manual button clicks and auto-merge.
  - The "Exclude Scenes with specified Tag Name" value must match the tag name exactly (case-sensitive). Stash's own name search is case-insensitive and treats `_` and `%` as wildcards, so the plugin fetches all candidates and re-checks the name on the client to be sure it excludes the tag you meant.
  - The "Exclude Tags marked via a Custom Field" value must match the custom field name exactly (case-sensitive). The plugin only queries tag custom fields when this setting is non-empty, so leaving it blank keeps them out of every merge query.
  - If the exclusion-tag lookup fails (server restart, network blip), the merge aborts rather than running unfiltered — merging into a scene you meant to protect is not something a button click can take back, since merging only ever adds tags. A manual click reports this in an alert; an auto-merge reports it only to the browser console, so nothing visibly happens in the UI.
  - That lookup is cached — 60 seconds for a hit, 10 for a miss — so creating, renaming or deleting the tag takes up to a minute to be noticed, and a merge in the meantime can run unfiltered. Waiting the window out is enough; reload the page to apply it at once, since navigating within Stash does not clear the cache. Pointing the setting at a different name takes effect immediately.
- **Auto-merge and staging**
  - Auto-merge only runs when the edit that triggered it actually succeeded; a save that Stash rejects does not cause a merge.
  - While a merge is running, auto-merge ignores other edits saved in the meantime; this is what stops the plugin from reacting to its own updates.
  - Staging diffs against the tag box as it stands, not against the saved scene, so tags you added or removed by hand before clicking are preserved — and clicking again without saving reports "No changes". The exclusion filters still apply, so an excluded scene stages nothing.
- **Settings and concurrent edits**
  - All settings (including exclusion filters) are re-read every 10 seconds, and also shortly after you navigate, so a change takes effect without a page reload. The navigation refresh is rate limited to once every 2 seconds, so browsing quickly does not turn every click into a settings query.
  - A merge submits the scene's tags as a complete list, so a tag edit made in another tab at the same time can be overwritten — exactly as it would be if you saved the same scene from two Stash tabs at once. For the same reason nothing is kept fresh across tabs: reload the page if you have been editing the same scene or performer elsewhere.

## If you also use the Normalize Parent Tags plugin

That plugin's writes look like any other edit from in here, and this plugin's two auto-merge
settings react to *any* scene or performer save they see:

- **Auto Merge On Scene Updates** — every scene that plugin touches gets its performers' tags
  merged back in, parents included.
- **Auto Merge On Performer Updates** — every performer it touches has their tags pushed out to
  *all* of their scenes.

**Normalize Parent Tags** rewrites tags across the whole library, so without cooperation
auto-merge would merge performer tags — parents included — straight back into everything it had
just changed.

Since 1.1.0 the two cooperate. While Normalize Parent Tags is applying changes it takes a
short-lived, self-expiring claim that this plugin honours: **auto-merge stands down for the
duration and resumes as soon as the apply finishes**, including if it fails or is stopped. One
line is written to the browser console when it happens:

```
[cpt2s] auto-merge is standing down while NormalizeParentTags applies bulk changes (Prune Parent Tags from Entities)
```

Nothing is changed in your settings, other browser tabs are unaffected, and **manual button
clicks are never suppressed** — you asked for those directly. If the other plugin's tab crashes
mid-run, the claim expires on its own rather than leaving auto-merge disabled until a reload.

It works the other way round too. The library-wide task above rewrites scenes across your whole
library, so while it is applying changes **it takes the same kind of claim**, for any plugin that
watches for one. And if you start it while another plugin is mid-run, the dialog says so and lets
you decide — running both at once means each may undo part of the other.

Normalize Parent Tags also has two settings of its own that react to every save — **Auto Prune on
Entity Updates** and **Auto Roll Up on Entity Updates**. If either is on when you start the
library-wide task, the dialog tells you which, and what it would do to the merge:

- **Auto Prune** removes the parent tags this merge adds, wherever a more specific tag on the same
  scene already implies them. That is often exactly what you want — merge everything, then let the
  redundant parents fall away — but it is worth knowing before you read the result.
- **Auto Roll Up** adds every ancestor of the tags this merge adds, so scenes end up with more tags
  than the review listed.

If that plugin is new enough to stand down for the claim, the dialog says so and there is nothing
to do. If it is not — or if it is switched off in Stash, which looks the same from here — you get a
warning instead, naming the setting. It never stops the run; you pressed the button.

If none of those settings are on, there is no interaction at all.

This only covers plugins running in your browser. A plugin with server-side **hooks** — the
Python or executable kind that Stash runs on `Scene.Update.Post` and similar — runs inside Stash
itself, cannot be asked to stand down from here, and will react to this plugin's changes like any
other edit. If you have one that touches tags, disable it for the run.

## If you also use Propagate Tags and Performers to Related Entities

That plugin implements this same merge as one of its thirteen relationship paths, so both plugins
can end up doing the same work. Since 1.12.0 the library-wide task's dialog notices — if that
plugin has its equivalent path enabled, a line in the log says so. This is purely informational:
both plugins only ever add tags, so running both is redundant work and doubled log lines, never
wrong data. Nothing is suppressed and nothing blocks; disable one if you would rather not see it
twice.

Where both plugins' manual buttons land in the same row (the performer detail view, the scene Edit
tab), each used to place itself immediately next to Save or Delete independently of the other, so
whichever plugin's button finished appearing last ended up closest to it — a detail decided by
network timing, not a rule, that could flip between page loads. Since 1.13.0 the two plugins agree
on a fixed relative order instead, regardless of which one finishes first. Since 1.14.0, the scene
button's own anchor also moved from before Save to between Save and Delete — matching where the
performer button, and `PropagateTagsAndPerformers`' own buttons, already land. Since 1.15.0, a page
with Save but no Delete lands its button before Save instead of appending after it, so Stash's own
primary action always stays the last thing in the row.

**1.15.1 is the version where that actually started working on the scene Edit tab.** Up to 1.15.0
the plugin looked for Delete only by the CSS class Stash puts on it — and on the scene Edit row it
does not put one there, so the button kept landing before Save no matter what the previous three
versions changed. It now recognises Delete by its label as well. If you are on 1.15.0 or earlier and
your buttons sit to the left of Save, this is why; update and they will move between Save and
Delete.

**1.15.2 gives the scene button room on its right.** It carried a left-only margin, which was right
while it sat at the end of the row — but since 1.14.0 it sits between Save and Delete, so it
rendered flush against Delete with nothing between them. The performer button already had margins on
both sides for the same reason.

**1.15.3 takes the spacing from the row instead of choosing it.** The button's margins now match
whatever Stash's own buttons in the same row use, so every gap in the row is the same rather than
ours being a different width from its neighbours'. On the scene Edit tab it also spaces a wrapped
row properly, which the previous approach could not: that row is not laid out the way the performer
page's is, and the spacing property being set only works on the latter.

**1.15.4 is what makes 1.15.3's spacing visible.** The margins it measured were being overridden by
a styling class the buttons still carried, so the wrapped-row half of that release worked and the
horizontal half changed nothing at all. That class is now applied only when there is nothing in the
row to measure, and a row that spaces its own buttons by other means is left alone entirely rather
than given a margin on top of it.

**1.15.5 stops the performer button landing flush against the one before it.** Stash spaces the
performer navbar unevenly — some of its own buttons touch each other there — so matching one of them
exactly is not the same as looking right next to it. The button now fills in whatever gap its actual
neighbours leave, which changes nothing on the scene Edit tab and un-sticks the detail page.

**1.15.6 measures that gap instead of working it out.** Reading what the neighbouring button is set
to only answers the question where that button is the one you can see beside ours; where a gap comes
from something else, it double-counts — which is what `PropagateTagsAndPerformers` hit on Group.
This plugin's own pages were unaffected, and the shared rule is kept identical in both.

