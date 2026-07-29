# Merge Performer Tags To Scenes

A simple, front-end-only Stash plugin. It adds a **"Merge Tags to Scenes"** button
to each performer's page (next to the Edit/Delete buttons). Clicking it:

1. Reads the performer's tags.
2. Finds every scene that includes this performer.
3. Adds the performer's tags to each scene's tag list, **merging** with (not
   replacing) whatever tags the scene already has.

Scenes that already have all of the performer's tags are skipped, and a summary
alert reports how many scenes were updated.

## How it works

This plugin is pure client-side JavaScript (`ui.javascript` in the manifest,
no backend task). It calls Stash's `/graphql` endpoint directly from the
browser using your existing logged-in session — no server-side plugin task or
Python runtime required.

## Installation

1. Find your Stash plugins directory. This is the `plugins` folder inside
   the directory that holds your `config.yml` (the same place as your Stash
   database, typically shown at the top of **Settings → System**). If no
   `plugins` folder exists there yet, create one.
2. Copy the whole `MergePerformerTagsToScenes` folder (with both
   `MergePerformerTagsToScenes.yml` and `MergePerformerTagsToScenes.js` inside
   it) into that `plugins` folder, so you end up with:
   ```
   <stash-config-dir>/plugins/MergePerformerTagsToScenes/MergePerformerTagsToScenes.yml
   <stash-config-dir>/plugins/MergePerformerTagsToScenes/MergePerformerTagsToScenes.js
   ```
3. In Stash, go to **Settings → Plugins** and click **Reload plugins**
   (or simply restart Stash).
4. You should see "Merge Performer Tags To Scenes" listed. No configuration
   is needed — there's nothing to enable, the UI script loads automatically.
5. Do a hard refresh of the page in your browser (Ctrl+Shift+R) so the new
   plugin JavaScript is loaded.

## Usage

Open any performer's page. A **"Merge Tags to Scenes"** button appears next to
the Edit/Delete buttons. Click it, confirm the prompt, and wait for the
"Done." summary alert.

## Notes / limitations

- Only the tags of the performer whose page you're on are copied — if a
  scene has multiple performers, tags from the *other* performers on that
  scene are left untouched.
- This does not run automatically on tag/performer/scene changes — it's a
  manual, one-click action per performer.
- Large scene counts for a performer are processed one scene at a time
  (sequentially) to avoid hammering the server; this is deliberate, not a bug.
