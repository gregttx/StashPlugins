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
rewrite many entities on purpose (`NormalizeParentTags` phase 2). A bulk plugin's writes look
exactly like user edits, so the reactive plugin fires on every one of them — often undoing the
bulk plugin's work as fast as it lands.

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
- **UI plugins only.** A server-side `hooks:` plugin runs in the Stash process, never sees this
  `window`, and cannot be leased against. Do not let documentation imply otherwise.

## Tests

`node tests/run.js` (or `npm test`) runs the suites in `tests/`. They evaluate a plugin inside a `vm` context holding a hand-rolled browser and drive it by answering its GraphQL requests — see `tests/README.md`.

Most of it needs no install. The `placement` suite needs `jsdom` and skips itself without it; `npm install` enables it. `package.json` exists only for this — it is not part of any plugin.

Tests cover the plugin's own logic and its assumptions about Stash's markup and component props. They cannot confirm those assumptions still hold after a Stash upgrade, so a change that touches Stash's DOM or components still needs exercising in a live Stash instance.

When fixing a bug, check the new test fails against the unfixed plugin before trusting it: `SRC=/path/to/old.js node tests/<suite>.test.js`.
