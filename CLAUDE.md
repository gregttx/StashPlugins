# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A collection of client-side JavaScript plugins for [Stash](https://github.com/stashapp/stash), a self-hosted media server. Each plugin lives in its own folder and consists of exactly two files:

- `<PluginName>.yml` — the plugin manifest (name, version, declared JS files)
- `<PluginName>.js` — the browser-side script Stash injects into its UI

There is no build step, no package manager, no test framework, and no transpilation. The JS is vanilla ES5 wrapped in an IIFE and runs directly in the browser.

## Plugin architecture

Stash loads plugins declared under `ui.javascript` in the manifest into its React SPA at runtime. The scripts have no access to React internals — they manipulate the DOM directly and call Stash's `/graphql` endpoint via `fetch` using the user's existing browser session (no auth tokens needed).

Because Stash is a SPA, plugins must handle route changes without a full page reload. The standard pattern used here is:

1. A `tick()` function that checks the current URL and idempotently injects/removes UI elements.
2. `tick()` is wired to `window load`, `popstate`, link-click delays (`setTimeout(tick, 300)`), and a `MutationObserver` on `#root` (plus a fallback `setInterval`).

## Plugin examples

Some sample Stash plugins can be found at:
https://github.com/stashapp/CommunityScripts/tree/main/plugins

## Adding a new plugin

1. Create a new folder: `<PluginName>/`
2. Add `<PluginName>.yml` — copy the manifest structure from an existing plugin.
3. Add `<PluginName>.js` — write an IIFE in ES5; no `import`/`export`, no bundler.
4. Install by copying the folder into `<stash-config-dir>/plugins/` and reloading plugins in Stash Settings.

## GraphQL conventions

All Stash data access goes through `POST /graphql`. The helper `gqlRequest(query, variables)` pattern (returning a Promise that throws on `errors`) is the standard used across plugins. Use `per_page: -1` to fetch all results in a single query rather than paginating.

## No build step

The plugins have no build step, no bundler, and no runtime dependencies. A plugin folder is installed by copying it as-is.

## Cross-plugin cooperation: the bulk-edit lease

Two kinds of plugin in this repo collide by design. **Reactive** plugins watch `window.fetch` for
Stash's own mutations and act on them (`MergePerformerTagsToScenes` auto-merge). **Bulk** plugins
rewrite many entities on purpose (`NormalizeParentTags` phase 2, and
`MergePerformerTagsToScenes`' own library-wide task). A bulk plugin's writes look exactly like
user edits, so the reactive plugin fires on every one of them — often undoing the bulk plugin's
work as fast as it lands.

The two roles are per *run*, not per plugin: `MergePerformerTagsToScenes` is reactive through its
auto-merge modes and bulk during its task, and holds both halves of the protocol at once.

Every plugin loaded into a Stash page shares one `window`, which is enough for a handshake. A bulk
plugin takes a **lease** for the duration of its writes; a reactive plugin checks for a lease
before acting, and stands down while one is held.

```js
// Shared object, created by whichever plugin loads first. Both roles call this.
function coop() {
  var c = window.StashPluginCoop;
  if (!c || typeof c !== 'object') c = window.StashPluginCoop = {};
  if (!c.leases) c.leases = [];          // [{ owner, label, until }]
  if (!c.respecters) c.respecters = {};  // { pluginId: true }
  return c;
}
```

**Bulk side** — `acquire(owner, label, ttlMs)` pushes a lease and returns a handle with `renew()`
and `release()`. Renew per batch rather than taking one long lease; release in a `finally` so an
error, a failed batch or a user Stop cannot leave it latched.

**Reactive side** — register once at load (`coop().respecters[PLUGIN_ID] = true`), and before
reacting, drop leases whose `until` has passed and skip if any remain. Registering is what lets a
bulk plugin tell "the sibling will stand down" from "the sibling is too old to know", so it can
warn the user accordingly.

Rules that make this safe:

- **Advisory, never assumed.** A plugin older than the protocol, or one nobody has heard of, will
  ignore the lease. The bulk plugin still needs its fallbacks (ordering, a rescan, a warning).
- **Always expiring.** A tab that crashes mid-run must not disable a reactive plugin until the
  next reload, so a lease is only honoured until `until`.
- **Per tab**, like the reactive plugins themselves. Another tab is unaffected, which is correct:
  its `fetch` never sees these writes.
- **Not a re-entrancy guard.** A plugin suppressing reactions to *its own* writes (the
  `_mergeDepth` counter in `MergePerformerTagsToScenes`) is a separate, internal mechanism. Leases
  are about *other* plugins.
- **Take one for every bulk run, even with nothing listening.** Both plugins here are now on both
  sides — `NormalizeParentTags` gained reactive auto-prune/roll-up modes at its 1.1.0 — so a lease
  taken in this repo is honoured in this repo. It was still the rule while nothing listened: the
  protocol is not ours alone, and a bulk run that does not announce itself is exactly what a third
  plugin could not defend against. **An Undo is a bulk run too**, and both dialogs lease theirs,
  labelled `<task> (undo)`.
- **A reactive run can be bulk enough to need one.** `NormalizeParentTags`' auto mode reacts to a
  bulk mutation by rewriting every entity it touched, which is a bulk write by any measure, so it
  leases too — with a much shorter TTL, measured in the seconds one reaction lasts rather than the
  minutes a library-wide task does. The TTL is what a crashed tab leaves behind; size it to the work.
- **Warn on someone else's, never stand down for it.** A bulk run is started by hand, and §7 of
  `MergePerformerTagsToScenes`' CLAUDE.md is that manual actions are not suppressed. Both dialogs
  therefore *say* a lease is held and carry on — an advisory the user can act on, not a lock.
- **UI plugins only.** A server-side `hooks:` plugin runs in the Stash process, never sees this
  `window`, and cannot be leased against. Do not let documentation imply otherwise.

## Cross-plugin cooperation: the shared dialog chrome

Both plugins put up a full-screen review dialog, and they are one design: same head with a warning
and a legend, same monospace log with a rendered tail, same footer of Proceed / Stop / Copy log /
Rescan / Undo / Close, same `btn btn-secondary btn-sm` buttons borrowed from Stash. A plugin folder
is copied as-is, with no build step and no shared module, so neither can import the other's
stylesheet: each carries its own CSS string, `CSS` in `NormalizeParentTags` and `TASK_CSS` in
`MergePerformerTagsToScenes`.

**Keep the overlapping rules byte-identical.** They drifted once — the modal was `#202b33` in one
and `#30404d` in the other, with a `font-size` and a `z-index` to match — because the second dialog
was written a day after the first and nobody compared them. `tests/style.test.js` now parses both
strings, strips the `npt-` / `cpt2s-` prefixes and fails on any selector the two define differently.

Only the overlap is pinned. Rules the other dialog has no use for — the hierarchy viewer's tree and
inspector, each plugin's own log-line kinds (`REMOVE`/`ADD` against `MERGE`) — are free to differ,
and the suite ignores selectors it finds on one side only.

**`#202b33` is the modal background** — Blueprint's `dark-gray2`, the step Stash's own page uses.
The alternative the two drifted between, `#30404d` (`dark-gray4`), is what Stash puts on raised
surfaces like cards, and it is the more conventional choice for a modal. It lost on contrast:
every dim grey in these dialogs was picked against `#202b33` — the log's `#a7b6c2` INFO and
`#7d8f9c` legend, and the hierarchy viewer's `#3c4f5d` row hover and `#425a6b` selection — and all
of them separate less on the lighter panel. Changing the modal means re-tuning those, so change
them together or not at all. Both greys are Blueprint and both look native, which is exactly why
the drift went unnoticed for four months.

## Tests

`node tests/run.js` (or `npm test`) runs the suites in `tests/`. They evaluate a plugin inside a `vm` context holding a hand-rolled browser and drive it by answering its GraphQL requests — see `tests/README.md`.

Most of it needs no install. The `placement` suite needs `jsdom` and skips itself without it; `npm install` enables it. `package.json` exists only for this — it is not part of any plugin.

Tests cover the plugin's own logic and its assumptions about Stash's markup and component props. They cannot confirm those assumptions still hold after a Stash upgrade, so a change that touches Stash's DOM or components still needs exercising in a live Stash instance.

When fixing a bug, check the new test fails against the unfixed plugin before trusting it: `SRC=/path/to/old.js node tests/<suite>.test.js`.

## Reference: custom fields in Stash

Findings from reading `stashapp/stash` `graphql/schema/types/*` on `main`, 2026-08-04. Verify
against the running Stash version before relying on any of it — this is a snapshot, not a contract.

Seven entity types carry custom fields, marked by `custom_fields: Map!` on the object type: **Scene,
Image, Gallery, Performer, Studio, Group, Tag**. Scene markers do not, nor do files or folders.

Bulk mutations already accept custom fields for five of the seven. The field is
`custom_fields: CustomFieldsInput` on the bulk input:

| Entity | On type | Single update | Bulk update input |
|---|---|---|---|
| Scene | yes | yes | yes — `BulkSceneUpdateInput` |
| Image | yes | yes | yes — `BulkImageUpdateInput` |
| Gallery | yes | yes | yes — `BulkGalleryUpdateInput` |
| Performer | yes | yes | yes — `BulkPerformerUpdateInput` |
| Group | yes | yes | yes — `BulkGroupUpdateInput` |
| Studio | yes | yes | **no** — `BulkStudioUpdateInput` |
| Tag | yes | yes | **no** — `BulkTagUpdateInput` |

So "Stash can't bulk edit custom fields" is a UI limitation, not an API one, for everything except
Studio and Tag. No `Edit*Dialog.tsx` bulk modal exposes custom fields; `customFields` appears only in
the per-object edit panels, detail panels, merge dialogs and filter components. A plugin can bulk
edit custom fields today by calling the bulk mutation directly for the five supported types, and by
looping single updates for Studio and Tag.

The input type suits bulk work directly:

```graphql
input CustomFieldsInput {
  full: Map         # replace the entire map
  partial: Map      # update only the keys in this map
  remove: [String!] # delete these keys
}
```

`partial` sets a key across a selection without disturbing the others; `remove` clears one. Prefer
these over `full`, which discards any key the caller did not send.

Reading them back is the awkward part: there is no way to query objects for *whichever* custom
fields they happen to have. Filtering goes through `custom_fields: [CustomFieldCriterionInput!]`
(`field`, `value`, `modifier`), which requires naming the key up front. Any plugin offering a
key-picker has to source the names from somewhere else — user input, or a scan of fetched objects.

Upstream issues, none of which is a bulk-edit-values request (searched 2026-08-04, nothing filed):

- [#6795](https://github.com/stashapp/stash/issues/6795) — globally defined custom fields rather
  than per-record. Closest match; mentions bulk *management of definitions* (rename, delete,
  reorder), not editing values across a selection. A contributor notes per-record was intentional,
  with plugins expected to manage fields.
- [#5336](https://github.com/stashapp/stash/issues/5336) — RFC replacing the bulk modal's
  Overwrite/Add/Remove tabs with tri-state checkboxes. Multi-value fields only.
- [#4823](https://github.com/stashapp/stash/issues/4823) — fields missing from the image bulk edit
  modal. Same shape of complaint, different fields.
- [#6394](https://github.com/stashapp/stash/issues/6394) — scrapers returning custom fields.
- [#5970](https://github.com/stashapp/stash/issues/5970) — GraphQL sorting by custom field value.
