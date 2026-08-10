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
  if (!c.declares) c.declares = {};      // { pluginId: [pathId, ...] }
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

## Cross-plugin cooperation: the `declares` registry

A third, narrower mechanism, added when `PropagateTagsAndPerformers` made `MergePerformerTagsToScenes`'
one path (copying a scene's performers' tags onto it) one of thirteen a second plugin now also
performs. Both only ever add, so running both is never wrong — just redundant work and doubled log
lines — and the two are otherwise strangers, sharing no module and no knowledge of each other's
existence.

**What it is for, precisely: two plugins performing the *identical* relationship copy.** A path id
is the same string `PropagateTagsAndPerformers`'s own `PATHS` table uses (`'tags:performer>scene'`,
`'tags:studio>group'`, …) — the vocabulary that plugin already had to invent for its thirteen paths,
reused rather than duplicated. `MergePerformerTagsToScenes` declares its one path unconditionally at
load, the way it registers as a lease respecter; `PropagateTagsAndPerformers` republishes its
*currently enabled* paths on every settings load, task or auto mode alike, since a path whose
setting is off is not one it is actually covering. Each plugin scans the registry for **other**
entries containing a path id it also handles, and notes the overlap in its dialog log — informational
only, never a head warning, because redundant work is not a hazard the way NPT's collision (below)
is.

**A future third relationship-copying plugin needs no existing plugin edited.** It declares its own
paths at load and gets warned about, and warns about, both siblings automatically — that genericity
is the entire reason this exists rather than a second hardcoded pairwise check.

**What it deliberately does *not* replace: `NormalizeParentTags`' collision with either sibling.**
`checkSibling` in `MergePerformerTagsToScenes` (reading NPT's `a8AutoPruneOnUpdate` /
`a9AutoRollUpOnUpdate`) and its mirror in `PropagateTagsAndPerformers` (`checkHierarchySibling`,
added alongside `declares` for the same reason) stayed hardcoded, name-based checks reading a named
sibling's actual settings. That collision is not "the same path" — NPT walks the tag *hierarchy*
and the other two walk entity *relationships*, two different graphs — so there is no path id on
either side for a generic scan to match. Prune can undo an addition regardless of which relationship
put the tag there, which is a category-level interaction (any hierarchy-rewriter versus any
additive tag-writer), not a per-path one. Folding it into `declares` would need a second, richer
vocabulary (categories, not path ids, plus a collision matrix between them) that no plugin here
needs yet; forcing today's problem into that shape now would have been a false generalisation. If a
fourth plugin ever adds a *second* hierarchy-rewriter, this is the seam to revisit — not before.

**`NormalizeParentTags` declares nothing.** It has no relationship-copy paths to publish, so its
`coop()` gained the `declares` field only for shape-consistency across all three plugins' shared
object — nothing reads an absent entry as anything other than "declares nothing", the same way
`respecters` already treats an unregistered plugin.

## Cross-plugin cooperation: deterministic button ordering

A fourth, narrower mechanism than the three above — this one is not about avoiding a duplicate or a
collision, but about two *legitimate* buttons from two different plugins sharing one row
(`.edit-buttons` on Scene, `.details-edit` on Performer/Studio/Group) and needing a fixed relative
order.

**The problem it replaces: a race decided by network timing.** `MergePerformerTagsToScenes` and
`PropagateTagsAndPerformers` each place their manual buttons with `insertBeforeDelete`, and both
independently re-find the anchor's *current* live position and insert immediately before it. With
one plugin that is enough; with two, whichever plugin's async eligibility/existence check happened
to resolve last ended up closest to Delete — a detail that could flip between page loads depending
on which round trip landed first, not something either plugin's own code decided.

**One anchor, not two.** Both plugins' target-side buttons (Scene/Gallery/Image/Group) originally
anchored on *Save* instead (`insertBeforeSave`), landing buttons before it — a separate mechanism
from the source-side buttons' `insertBeforeDelete`, because Save carries no CSS class the way Delete
does and needed its own text-matching walk to find. Live feedback after that shipped was that
"before Save" was not the wanted position — "between Save and Delete" was. Since Delete already
sits right after Save on every page that has one, anchoring on Delete alone produces that without
either plugin needing to know where Save is at all, so `insertBeforeSave`/`findButtonByLabel` were
retired and every manual button, target and source side alike, now goes through the one
`insertBeforeDelete`. The one page without a Delete in this state — Group's edit form — falls back
to appending at the end, which is still after Save, the only button that page is confirmed to
render.

**`coop().order` is a fixed priority per plugin id**, registered unconditionally at load next to
`respecters[PLUGIN_ID] = true` — a number both sides pick once and keep consistent, the same way
the shared dialog chrome's overlapping CSS is pinned byte-identical rather than left to drift.
Higher sits closer to the anchor. `MergePerformerTagsToScenes` registers 20 (its buttons were on the
page first); `PropagateTagsAndPerformers` registers 10, leaving a gap of 10 either side for a future
third plugin to slot in without renumbering either existing value.

**Every button carries `_coopOwner = PLUGIN_ID`**, a plain JS property (not a DOM attribute — there
is no need to serialise it) set at the point each plugin builds its own button element. This is
what a sibling's insertion code reads back; a node with no `_coopOwner` is just part of Stash's own
markup and never treated as something to order against.

**`insertOrdered(container, button, anchor)` is the shared shape, duplicated in both plugins like
everything else in this repo — there is no module between them.** It walks backward from the anchor
over already-placed siblings, skipping past any whose owner outranks the inserting plugin (they
stay between the new button and the anchor) and stopping at the first one that does not (an unowned
Stash button, a same-or-lower-priority sibling, or the anchor itself). Two plugins converge on the
same final order regardless of which one ran first:

- MPTTS (20) already placed: PTP2RE (10) scans back, sees MPTTS's button outranks it, inserts
  before it → `[Save, PTP2RE, MPTTS, Delete]`.
- PTP2RE (10) already placed: MPTTS (20) scans back, sees PTP2RE's button does *not* outrank it,
  stops immediately and inserts before the anchor → `[Save, PTP2RE, MPTTS, Delete]`.

Same result either way. A plugin's own multiple buttons inserted in the same tick are unaffected —
same-priority siblings are never skipped, so left-to-right insertion order is preserved exactly as
it was before this existed.

**Only a priority number, never a name-based rule.** Nothing in `insertOrdered` mentions the other
plugin by id; it reads whatever `coop().order` and `_coopOwner` say, the same generic shape as
`declares`. A future third plugin needs only to pick an unused number and tag its own buttons — no
edit to either existing plugin.

## Placing a manual button near Stash's own actions: important vs. casual

A rule for *any* plugin injecting a button into a row Stash already put buttons in — distinct from
the ordering protocol above, which only decides relative order *between plugins*. This one decides
where a plugin's own button lands relative to *Stash's* buttons in that row, and it applies even
with only one plugin installed.

**Default: insert before the last button, only when the last button is important.** "Important"
means the row would look broken with anything landing after it — Stash's own destructive action
(Delete, styled `btn-danger`) or its own primary action (Save, and anything else that plays the
same role a row only has one of). Inserting before it keeps that button the last thing in the row,
which is where a user expects to find it. If the last button is a *casual* secondary action instead
(`btn-secondary`, no special role — "Auto Tag...", "Merge...") appending after it is fine and reads
more naturally than forcing a new button in front of an arbitrary earlier one.

**Neither Delete nor Save can be found by class. Both need a text fallback.** An earlier version of
this note said, as confirmed fact, that "Stash gives Delete a dedicated `.delete` class throughout".
It does not, and that sentence cost four versions of anchor churn in both plugins. The class is real
on the **performer detail navbar** — which is where it was actually observed, and where both plugins
still use it to tell a navbar from an edit form — but the **Scene edit row renders Delete as
`btn btn-danger` with no `.delete` at all**. Confirmed live 2026-08-10, against a row reading
`Save · Delete` where `container.querySelector('button.delete')` returns null.

So the anchor search is three steps, in order: `button.delete`, then a text match on `'Delete'`,
then a text match on `'Save'`. The text search (`findActionByLabel`, a plain recursive walk — neither
the shared test harness's fake DOM nor this concern needs `querySelectorAll`) matches `<a>` as well
as `<button>` and trims before comparing, because Stash styles some row actions as links and neither
the tag nor the padding is something a plugin here should have to be right about. Anchoring on
Delete lands a button *between* Save and Delete whenever both exist, which is a consequence of the
anchor order rather than a separate mechanism — there is only ever one search, trying those three
things and then giving up.

**The general lesson, worth more than the specific fix: a class confirmed on one page is evidence
about that page.** The churn happened because four successive versions reasoned about *which* anchor
to prefer while the anchor search was silently failing on the very row being tested. Before moving an
anchor again, check that the current one is being *found*.

**Giving up is the safe default, not an error.** A row whose last button is neither Delete nor Save
— unrecognised, or genuinely nothing — gets a plain append. Never invent a third detection tier for
a button this code cannot identify as important; a wrong guess about importance is worse than
sometimes appending after a button that would have preferred to stay last.

**Both `MergePerformerTagsToScenes` and `PropagateTagsAndPerformers` implement this as
`insertBeforeImportantAction`** (0.12.0 / 1.15.0), replacing an earlier `insertBeforeSave` /
`insertBeforeDelete` split that anchored on exactly one of the two and never fell back to the
other — which is what let a Delete-less page (Group's edit form) end up with a button appended
*after* Save, displacing Stash's own primary action from being last. The Delete-by-text step, and
`findButtonByLabel` becoming `findActionByLabel`, landed at 0.12.1 / 1.15.1. Read this note before
adding a manual button to any future plugin in this repo, not only these two.

## Cross-plugin cooperation: the shared dialog chrome

Every plugin here puts up a full-screen review dialog, and they are one design: same head with a
warning and a legend, same monospace log with a rendered tail, same footer of Proceed / Stop /
Copy log / Rescan / Undo / Close, same `btn btn-secondary btn-sm` buttons borrowed from Stash. The
same goes for the settings page since `NormalizeParentTags` 1.7.5 — the description split into a
visible summary and a hover box, and the group description behind a **Show more** toggle. A plugin
folder is copied as-is, with no build step and no shared module, so none can import another's
stylesheet: each carries its own CSS string, `CSS` in `NormalizeParentTags`, `TASK_CSS` in
`MergePerformerTagsToScenes`, `CSS` in `PropagateTagsAndPerformers`.

**Keep the overlapping rules byte-identical.** They drifted once — the modal was `#202b33` in one
and `#30404d` in the other, with a `font-size` and a `z-index` to match — because the second dialog
was written a day after the first and nobody compared them. `tests/style.test.js` parses all three
strings, strips the `npt-` / `cpt2s-` / `ptp2re-` prefixes, and fails on any selector two or more of
them define differently.

Only the overlap is pinned. Rules the others have no use for — the hierarchy viewer's tree and
inspector, each plugin's own log-line kinds (`REMOVE`/`ADD` against `MERGE` against `TAG`/`PERF`) —
are free to differ, and the suite ignores selectors it finds on one side only. The chrome and the
tooltip rules are additionally pinned **by name**, per plugin, so a plugin that quietly stopped
defining one of them fails rather than passing by having nothing left to disagree about.

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
