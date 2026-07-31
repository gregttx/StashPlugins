# Merge Performer Tags To Scenes

A front-end-only Stash plugin that adds two tag-merging buttons:

- **"Add Tags to Scene(s)"** on each performer's page — copies that performer's tags onto every scene featuring them.
- **"Add Perf Tags"** on each scene's page — copies all tags from all of that scene's performers into the scene.

Buttons are hidden by default and can be enabled in **Settings → Plugins → Merge Performer Tags To Scenes** via the **Show Manual Merge Buttons** toggle. When enabled, each button only appears when there is at least one related element to act on (a performer with scenes, or a scene with performers). Tags are **added** (not replaced) — existing tags are always kept.

Two optional auto-merge modes can also be enabled in the same settings panel:

- **Auto Merge On Scene Updates** — whenever a scene is saved, its performer tags are merged in automatically.
- **Auto Merge On Performer Updates** — whenever a performer is saved, their tags are merged into all of their scenes automatically.

Three optional exclusion filters let you protect certain scenes or tags from being touched:

- **Exclude Scenes marked as organized** — scenes with the "organized" flag set are skipped entirely.
- **Exclude Scenes with specified Tag** — enter a tag name; any scene carrying that tag is skipped. The tag is looked up by exact name and the result is cached until the setting changes.
- **Exclude Tags set to Ignore auto tag** — performer tags that have "Ignore auto tag" enabled in their tag settings are not copied into scenes.
- **Exclude Tags marked via a Custom Field** — enter a custom field name; performer tags that have that custom field present with a truthy value or an empty string are not copied into scenes (tags where the field value is `false`, `null`, or `0` are still included).

## How it works

This plugin is pure client-side JavaScript (`ui.javascript` in the manifest, no backend task). It calls Stash's `/graphql` endpoint directly from the browser using your existing logged-in session — no server-side plugin task or Python runtime required.

## Installation

1. Find your Stash plugins directory. This is the `plugins` folder inside the directory that holds your `config.yml` (the same place as your Stash database, typically shown at the top of **Settings → System**). If no `plugins` folder exists yet, create one.
2. Copy the whole `MergePerformerTagsToScenes` folder into that `plugins` folder:
   ```
   <stash-config-dir>/plugins/MergePerformerTagsToScenes/MergePerformerTagsToScenes.yml
   <stash-config-dir>/plugins/MergePerformerTagsToScenes/MergePerformerTagsToScenes.js
   <stash-config-dir>/plugins/MergePerformerTagsToScenes/manifest
   ```
3. In Stash, go to **Settings → Plugins** and click **Reload plugins** (or restart Stash).
4. Do a hard refresh in your browser (Ctrl+Shift+R) so the plugin JavaScript is loaded.

## Usage

**Performer page** — enable **Show Manual Merge Buttons** in settings, then open any performer's page. If they have at least one scene, an **"Add Tags to Scene(s)"** button appears next to the Edit/Delete buttons. Click it to copy the performer's tags to all their scenes. Scenes already having all the tags are skipped.

**Scene page** — enable **Show Manual Merge Buttons** in settings, then open any scene's page. If it has at least one performer, an **"Add Perf Tags"** button appears next to the Save/Delete buttons. Click it to add all tags from all performers in that scene into the scene's tag list.

## Notes / limitations

- The performer-page button (and auto-merge on performer update) processes scenes one at a time sequentially to avoid hammering the server.
- All settings (including exclusion filters) are re-read every 10 seconds; changes take effect without a page reload.
- Exclusion filters apply to both manual button clicks and auto-merge.
- The "Exclude Scenes with specified Tag Name" value must match the tag name exactly (case-sensitive).
- The "Exclude Tags marked via a Custom Field" value must match the custom field name exactly (case-sensitive).
- Tags are only added, never removed.
