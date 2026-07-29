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

## No build or test commands

There are no `npm`, `yarn`, or test commands. Verification is done by loading the plugin in a live Stash instance and exercising the UI manually.
