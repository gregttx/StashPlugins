# Merge Performer Tags To Scenes

> **Requires Stash 0.31.0 or newer.** Tag custom fields (the custom-field exclusion filter) and UI plugin component patching (staging tags in the scene edit form) both depend on it.

> **Upgrading to 1.1.1 from an earlier version resets the plugin's settings.** The settings were
> renamed internally so that the settings page lists them in a sensible order instead of
> alphabetically. Nothing else changed, but your previous choices are not carried over — open
> **Settings → Plugins → Merge Performer Tags To Scenes** and set them again. Everything is off
> until you do, so nothing merges by itself in the meantime.

A front-end-only Stash plugin that adds two tag-merging buttons:

- **"Add Tags to Scene(s)"** on each performer's detail view — copies that performer's tags onto every scene featuring them, regardless of any filter or selection in the scene list below.
- **"Add Perf Tags"** on each scene's Edit tab — puts all tags from all of that scene's performers into the scene's tag box for you to review and save (or saves them directly, if you enable **Save Tags Immediately**).

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

**"Add Perf Tags"** stops short of saving by default. The performer tags are dropped into the scene's own tag box, Stash's **Save** button lights up, and nothing is written until you press it. You can remove any tag you don't want first, and Cancel discards the lot.

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

**These lines go to your browser's own JavaScript console — not to Stash.** Open it with **F12** (or Ctrl+Shift+J / Cmd+Option+J) and pick the **Console** tab. This plugin runs entirely in the browser, so it has no way to write to the Stash server console or the **Settings → Logs** page; nothing will ever appear in either of those.

As soon as the plugin picks the setting up it says so once, so you can tell it is running before anything has been merged:

```
[MergePerformerTagsToScenes] merge logging enabled — one line will appear here per tag merged into a scene
```

If you tick the setting and that line never appears, check in this order: you are looking at the browser's console rather than the Stash log; the console's level filter is not hiding **Info** messages (Chrome collapses them under "Verbose"/"Info" in the level dropdown); and the browser is not still running an older copy of the plugin's JavaScript (reload plugins in Stash, then hard-refresh with Ctrl+Shift+R).

The action tells you where the tag went:

- **saved** — the tag was written to the scene. This covers the performer-page button, both auto-merge modes, and the scene button when **Save Tags Immediately** is on.
- **staged** — the tag was only put into the open edit form's tag box, and is not saved until you press Stash's **Save** button.

Only tags that actually changed something are logged: a tag the scene already carried, a scene skipped by an exclusion filter, and a scene whose update failed all produce no line (failures are reported separately as errors). A merge that had nothing to do is therefore silent — which is why the banner above exists. Scenes without a title are named by their file name.

This setting is independent of everything else — it does not change what gets merged, only what is reported. The extra fields the log line needs (tag names, scene titles) are requested from Stash only while it is enabled.

## Working alongside Normalize Parent Tags

Auto-merge reacts to *any* scene or performer save it sees, including saves made by another
plugin. **Normalize Parent Tags** rewrites tags across the whole library, so without cooperation
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

## How it works

This plugin is pure client-side JavaScript (`ui.javascript` in the manifest, no backend task). It calls Stash's `/graphql` endpoint directly from the browser using your existing logged-in session — no server-side plugin task or Python runtime required.

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

**Performer page** — enable **Show Manual Merge Buttons** in settings, then open any performer's page. If they have at least one tag and at least one scene, an **"Add Tags to Scene(s)"** button appears in the button bar on the detail view, just before the Delete button. Click it to copy the performer's tags to all their scenes. Scenes already having all the tags are skipped, and the button counts through the scenes as it goes.

**The scene list's filter does not narrow this.** The button asks the server for every scene featuring the performer, so searching, filtering or ticking scenes in the Scenes tab below has no effect on which scenes are updated — narrow the list to three scenes and all of them are still merged. Use the scene page's "Add Perf Tags" button if you want to act on one scene at a time. The button is deliberately hidden while the performer's edit form is open, since the scene list is not on screen there.

**Scene page** — enable **Show Manual Merge Buttons** in settings, then open a scene and switch to the **Edit** tab. If it has at least one performer, an **"Add Perf Tags"** button appears next to the Save/Delete buttons of the edit form. Click it to add all tags from all performers in that scene into the scene's tag list.

## Notes / limitations

- The performer-page button's eligibility (does the performer have tags and scenes) is only re-checked when the performer is saved or when you navigate to a different performer, not on every tick — so it stays correct without a page reload after you add tags to a previously tag-less performer, but a change made from elsewhere (bulk tag edit, another tab) is not noticed until one of those events happens.
- The performer-page button (and auto-merge on performer update) always covers every scene featuring the performer. Neither reads the scene list's filter or selection — the scenes come from a server query keyed only on the performer, so the plugin never sees what the list is showing. The only things that narrow it are the exclusion filters below.
- The performer-page button (and auto-merge on performer update) processes scenes one at a time sequentially to avoid hammering the server. If one scene fails to update, the remaining scenes are still processed and a summary of the failures is reported at the end (details go to the browser console).
- Auto-merge only runs when the edit that triggered it actually succeeded; a save that Stash rejects does not cause a merge.
- All settings (including exclusion filters) are re-read every 10 seconds, and also shortly after you navigate, so a change takes effect without a page reload. The navigation refresh is rate limited to once every 2 seconds, so browsing quickly does not turn every click into a settings query.
- Exclusion filters apply to both manual button clicks and auto-merge.
- The "Exclude Scenes with specified Tag Name" value must match the tag name exactly (case-sensitive). Stash's own name search is case-insensitive and treats `_` and `%` as wildcards, so the plugin fetches all candidates and re-checks the name on the client to be sure it excludes the tag you meant.
- The "Exclude Tags marked via a Custom Field" value must match the custom field name exactly (case-sensitive). The plugin only queries tag custom fields when this setting is non-empty, so leaving it blank keeps them out of every merge query.
- If the exclusion-tag lookup fails (server restart, network blip), the merge aborts rather than running unfiltered — merging into a scene you meant to protect is not something a button click can take back, since merging only ever adds tags. A manual button click reports this in an alert; an auto-merge reports it only to the browser console, so nothing visibly happens in the UI.
- The exclusion-tag lookup is cached, so a change to the tag itself takes up to a minute to be noticed. A successful lookup is reused for 60 seconds and a failed one for 10 seconds, both keyed on the configured name. Two consequences: a merge run just after you create the tag can still go unfiltered, and — because a deleted or renamed tag leaves an ID that no longer matches anything — so can one run just after you remove it. Waiting the window out is enough; reload the page if you want to merge immediately, since navigating within Stash does not clear the cache. Editing the setting to a different name also takes effect at once. A stale ID is reported to the browser console when it is next re-checked.
- When the scene-page button finds nothing to do (the scene is excluded by a filter, or already has every performer tag) it briefly shows "No changes".
- When staging, the exclusion filters still apply, so an excluded scene reports "Scene excluded" and stages nothing. The tags to add are diffed against what is currently in the tag box rather than what is on the server, so tags you have added or removed by hand before clicking are preserved.
- Staging works by observing Stash's tag control through the UI plugin API. The plugin picks the most recently rendered control whose contents match what it expects the scene's tag box to hold — the scene's saved tags to begin with, then whatever it last staged there. If it cannot identify a control it reports an error rather than writing tags into the wrong one.
- Clicking the button again without saving reports "No changes", because the count is measured against the tag box as it stands, not against the saved scene.
- Console logging reports a staged tag as soon as it lands in the tag box, not when you save. If you then remove it, or press Cancel, the line has already been logged — "staged" means exactly that, and nothing more.
- Stash uses the same container class for the performer detail view's Edit/Delete bar and for the performer edit form, so the plugin identifies the detail view by its Delete button. If a future Stash release changes that markup, the performer button will simply not appear rather than showing up in the wrong place.
- While a merge is running, auto-merge ignores other edits saved in the meantime; this is what stops the plugin from reacting to its own updates.
- A merge submits the scene's tags as a complete list, so a tag edit made in another tab at the same time can be overwritten — exactly as it would be if you saved the same scene from two Stash tabs at once. For the same reason the plugin does not try to keep data fresh across tabs: whether a performer's button appears, and what the scene page shows just after a merge, reflect what was loaded rather than what another tab has since changed. Reload the page if you have been editing the same scene or performer elsewhere.
- Merging only ever adds tags. The single exception is the library-wide task's **Undo** button,
  which removes tags that same dialog added — see [Undoing a run](#undoing-a-run).
