# Merge Performer Tags To Scenes

> **Requires Stash 0.31.0 or newer.** Tag custom fields (the custom-field exclusion filter) and UI plugin component patching (staging tags in the scene edit form) both depend on it.

A front-end-only Stash plugin that adds two tag-merging buttons:

- **"Add Tags to Scene(s)"** on each performer's detail view — copies that performer's tags onto every scene featuring them, regardless of any filter or selection in the scene list below.
- **"Add Perf Tags"** on each scene's Edit tab — puts all tags from all of that scene's performers into the scene's tag box for you to review and save (or saves them directly, if you enable **Save Tags Immediately**).

Buttons are hidden by default and can be enabled in **Settings → Plugins → Merge Performer Tags To Scenes** via the **Show Manual Merge Buttons** toggle. When enabled, each button only appears when there is something to act on: the performer button needs the performer to have both tags and scenes, and the scene button needs the scene to have performers. Tags are **added** (not replaced) — existing tags are always kept.

Two optional auto-merge modes can also be enabled in the same settings panel:

- **Auto Merge On Scene Updates** — whenever a scene is saved, its performer tags are merged in automatically.
- **Auto Merge On Performer Updates** — whenever a performer is saved, their tags are merged into all of their scenes automatically.

## Review before saving in Scene Edit tab manual merge

**"Add Perf Tags"** stops short of saving by default. The performer tags are dropped into the scene's own tag box, Stash's **Save** button lights up, and nothing is written until you press it. You can remove any tag you don't want first, and Cancel discards the lot.

Because nothing is saved, there is also no refresh and no jump back to the Edit tab — the tags simply appear in the box you're already looking at. The button reports what it did without changing width: *"Added 2"* then *"Save pending"*, or *"No changes"*, or *"Scene excluded"*.

Enable **Save Tags Immediately** in the plugin settings panel if you would rather it merge and save in one step, instead of the staging mode.

This setting only affects the scene page button. The performer button and both auto-merge modes always save directly, since they act on scenes whose edit forms aren't open.

Additionally, if the staging mode fails, the button merges and saves instead and logs the reason to the browser console — there is nothing to review on a Stash that cannot show you the staged tags. This could happen in the event of a breaking change in the way Stash handles the tag edit control for example.

## Exclusion filters

Four optional exclusion filters in settings let you protect certain scenes or tags from being touched:

- **Exclude Scenes marked as organized** — scenes with the "organized" flag set are skipped entirely.
- **Exclude Scenes with specified Tag** — enter a tag name; any scene carrying that tag is skipped. The tag is looked up by exact name and the result is re-checked periodically, so creating, deleting or recreating the tag is picked up without a page reload (a warning is logged to the browser console whenever the tag cannot be found). The exclusion tag itself is never copied into a scene, even if one of the performers carries it.
- **Exclude Tags set to Ignore auto tag** — performer tags that have "Ignore auto tag" enabled in their tag settings are not copied into scenes.
- **Exclude Tags marked via a Custom Field** — enter a custom field name; performer tags carrying that custom field are not copied into scenes. **Only the presence of the field matters** — the value is never looked at, so any value at all (including a blank one) excludes the tag. To have a tag merged again, remove the field from it rather than trying to set it to something falsy.

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
   ```
3. In Stash, go to **Settings → Plugins** and click **Reload plugins** (or restart Stash).
4. If using multiple browser instances, refresh your browser (F5) so the new plugin JavaScript is loaded in all of them.

## Usage

The two buttons appear in different places, because each one sits where the content it acts on is visible.

**Performer page** — enable **Show Manual Merge Buttons** in settings, then open any performer's page. If they have at least one tag and at least one scene, an **"Add Tags to Scene(s)"** button appears in the button bar on the detail view, just before the Delete button. Click it to copy the performer's tags to all their scenes. Scenes already having all the tags are skipped, and the button counts through the scenes as it goes.

**The scene list's filter does not narrow this.** The button asks the server for every scene featuring the performer, so searching, filtering or ticking scenes in the Scenes tab below has no effect on which scenes are updated — narrow the list to three scenes and all of them are still merged. Use the scene page's "Add Perf Tags" button if you want to act on one scene at a time. The button is deliberately hidden while the performer's edit form is open, since the scene list is not on screen there.

**Scene page** — enable **Show Manual Merge Buttons** in settings, then open a scene and switch to the **Edit** tab. If it has at least one performer, an **"Add Perf Tags"** button appears next to the Save/Delete buttons of the edit form. Click it to add all tags from all performers in that scene into the scene's tag list.

## Notes / limitations

- The performer-page button (and auto-merge on performer update) always covers every scene featuring the performer. Neither reads the scene list's filter or selection — the scenes come from a server query keyed only on the performer, so the plugin never sees what the list is showing. The only things that narrow it are the exclusion filters below.
- The performer-page button (and auto-merge on performer update) processes scenes one at a time sequentially to avoid hammering the server. If one scene fails to update, the remaining scenes are still processed and a summary of the failures is reported at the end (details go to the browser console).
- Auto-merge only runs when the edit that triggered it actually succeeded; a save that Stash rejects does not cause a merge.
- All settings (including exclusion filters) are re-read every 10 seconds, and also shortly after you navigate, so a change takes effect without a page reload. The navigation refresh is rate limited to once every 2 seconds, so browsing quickly does not turn every click into a settings query.
- Exclusion filters apply to both manual button clicks and auto-merge.
- The "Exclude Scenes with specified Tag Name" value must match the tag name exactly (case-sensitive). Stash's own name search is case-insensitive and treats `_` and `%` as wildcards, so the plugin fetches all candidates and re-checks the name on the client to be sure it excludes the tag you meant.
- The "Exclude Tags marked via a Custom Field" value must match the custom field name exactly (case-sensitive). The plugin only queries tag custom fields when this setting is non-empty, so leaving it blank keeps them out of every merge query.
- If the exclusion-tag lookup fails (server restart, network blip), the merge aborts rather than running unfiltered — merging into a scene you meant to protect cannot be undone automatically, since tags are only added, never removed. A manual button click reports this in an alert; an auto-merge reports it only to the browser console, so nothing visibly happens in the UI.
- The exclusion-tag lookup is cached, so a change to the tag itself takes up to a minute to be noticed. A successful lookup is reused for 60 seconds and a failed one for 10 seconds, both keyed on the configured name. Two consequences: a merge run just after you create the tag can still go unfiltered, and — because a deleted or renamed tag leaves an ID that no longer matches anything — so can one run just after you remove it. Waiting the window out is enough; reload the page if you want to merge immediately, since navigating within Stash does not clear the cache. Editing the setting to a different name also takes effect at once. A stale ID is reported to the browser console when it is next re-checked.
- When the scene-page button finds nothing to do (the scene is excluded by a filter, or already has every performer tag) it briefly shows "No changes".
- When staging, the exclusion filters still apply, so an excluded scene reports "Scene excluded" and stages nothing. The tags to add are diffed against what is currently in the tag box rather than what is on the server, so tags you have added or removed by hand before clicking are preserved.
- Staging works by observing Stash's tag control through the UI plugin API. The plugin picks the most recently rendered control whose contents match what it expects the scene's tag box to hold — the scene's saved tags to begin with, then whatever it last staged there. If it cannot identify a control it reports an error rather than writing tags into the wrong one.
- Clicking the button again without saving reports "No changes", because the count is measured against the tag box as it stands, not against the saved scene.
- Stash uses the same container class for the performer detail view's Edit/Delete bar and for the performer edit form, so the plugin identifies the detail view by its Delete button. If a future Stash release changes that markup, the performer button will simply not appear rather than showing up in the wrong place.
- While a merge is running, auto-merge ignores other edits saved in the meantime; this is what stops the plugin from reacting to its own updates.
- A merge submits the scene's tags as a complete list, so a tag edit made in another tab at the same time can be overwritten — exactly as it would be if you saved the same scene from two Stash tabs at once. For the same reason the plugin does not try to keep data fresh across tabs: whether a performer's button appears, and what the scene page shows just after a merge, reflect what was loaded rather than what another tab has since changed. Reload the page if you have been editing the same scene or performer elsewhere.
- Tags are only added, never removed.
