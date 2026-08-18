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
2. Add `<PluginName>.yml` — copy the manifest structure from an existing plugin. **`version: 0.0.1`**
   — see below, and do not reason your way past it.
3. Add `<PluginName>.js` — write an IIFE in ES5; no `import`/`export`, no bundler.
4. Install by copying the folder into `<stash-config-dir>/plugins/` and reloading plugins in Stash Settings.

### A new plugin starts at 0.0.1, and the major digit is a claim to the user

**Not a style preference — a statement about whether the thing works.** `0.x` says "written";
`1.0.0` says "finished and worth installing". Only running it in a real Stash can support the
second, because every plugin here is a set of guesses about Stash's markup that no test in this repo
can check (see "Anchoring in Stash's markup" in each plugin's own CLAUDE.md).

**The failure mode is specific and has happened twice.** Both times the reasoning was *"this one is
complete, so 1.0.0"* — which is a fact about the code and answers a question nobody asked. The
first time was `PropagateTagsAndPerformers`, caught at step 1 of 8; the second was
`CustomFieldsBulkEditor`, which shipped at 1.0.0 with a passing suite and not one live click behind
it, and was corrected to 0.0.1. **A complete implementation is not a release candidate.** If you
find yourself weighing 0.0.1 against something higher for a plugin nobody has run, the answer is
0.0.1.

The cadence from there: **patch** for a fix, **minor** for a delivered capability, and the major
digit moves exactly once — when the plugin has been used in a live instance and the unverified list
in its CLAUDE.md is empty. `PropagateTagsAndPerformers`' step table is the worked example.

## GraphQL conventions

All Stash data access goes through `POST /graphql`. The helper `gqlRequest(query, variables)` pattern (returning a Promise that throws on `errors`) is the standard used across plugins. Use `per_page: -1` to fetch all results in a single query rather than paginating.

## No build step

The plugins have no build step, no bundler, and no runtime dependencies. A plugin folder is installed by copying it as-is.

## The manifest `date:` is read off the clock, never derived from the last one

Each plugin's `manifest` carries `date: "YYYY-MM-DD HH:MM:SS"` beside its `version:`. Read it from
the machine, in the same edit as the version bump:

```bash
NOW="$(date '+%Y-%m-%d %H:%M:%S')" && sed -i "s/^date: \".*\"/date: \"$NOW\"/" <Plugin>/manifest
```

**Local time, the same clock `git commit` stamps** — so a release date and the commit that shipped
it agree. Do not substitute the date from the session context: that one is UTC, and for most of the
user's working day it is already tomorrow. On 2026-08-11 at 19:22 PDT the context said 2026-08-12,
which is how a "correct" date landed a day early.

**Never take the newest `date:` already in the repo and nudge it forward.** That was the actual
failure: a session, reluctant to move a release date backwards, read the previous manifest instead
of the clock and added to it. The next session read *that* and added again, so three manifests
reached 2026-08-14 and then 2026-08-16 while the real date was 2026-08-11. An error seeded this way
never decays — it compounds once per release.

**A date moving backwards is not a problem to work around; it is the correction.** It means the
earlier release date was wrong, and the clock is the only thing that decides. Nothing reads this
field programmatically — Stash's source index shows it, and Stash compares `version:`, not dates —
so the sole cost of a wrong one is a user seeing a plugin dated in the future and doubting the rest.

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
// The one global this repo reserves. Byte-identical in all three plugins.
function coopObject() {
  var ns = window.__GTTx__;
  if (!ns || typeof ns !== 'object') ns = window.__GTTx__ = {};
  var c = ns.StashPluginCoop || window.StashPluginCoop;   // adopt an older sibling's
  if (!c || typeof c !== 'object') c = {};
  ns.StashPluginCoop = c;
  if (window.StashPluginCoop !== c) window.StashPluginCoop = c;   // alias, same object
  return c;
}

// Shared object, created by whichever plugin loads first. Both roles call this.
function coop() {
  var c = coopObject();
  if (!c.leases) c.leases = [];          // [{ owner, label, until }]
  if (!c.respecters) c.respecters = {};  // { pluginId: true }
  if (!c.declares) c.declares = {};      // { pluginId: [pathId, ...] }
  return c;
}
```

**`coop().api` is created by the plugins that use it, and deliberately not added to the other
three.** `declares` was given to every plugin for shape-consistency because any of them might scan
it; an `api` entry is only meaningful to a publisher or to a caller, and an absent one reads as
"nobody published", exactly the way an absent `respecters` entry already reads. Adding the field to
three plugins that neither publish nor call would be three version bumps for a key nothing looks at.

**`window.__GTTx__` is the only global this repo takes, and everything shared hangs off it.**
`StashPluginCoop` on its own was a name any third-party plugin could have picked, and a collision
would hand someone else's object our leases. Nothing else here needs a global: every CSS class is
already prefixed (`npt-` / `cpt2s-` / `ptp2re-`), every element id is `plugin-<id>-<key>` or a
plugin-prefixed one of ours, and per-plugin state stays inside the IIFE. A new shared object goes
*beside* `StashPluginCoop` under `__GTTx__`, never on `window`.

**`setting-group` is not ours and must not be renamed.** It is Stash's own class on the settings
page, and these plugins only ever *read* it — `ownSettingGroup`, `ownTaskName`, `settingRow`. The
same goes for `.setting`, `.details-edit`, `.edit-buttons`, `.nav-tabs` and `.sub-heading`. Prefixing
a class we do not own would simply stop finding the element.

**The bare `window.StashPluginCoop` stays as an alias to the same object**, and an existing one is
adopted rather than replaced. A user who updates one plugin and not the others has two releases of
the protocol in one tab; the alias costs a line, and a missed lease costs a bulk run.

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
- **A plugin that never writes at all takes no lease either.** `TagBundleClipboard` is the first,
  and it is the case the three rules below do not cover: it registers no lease (there is no bulk
  write to announce), no `respecters` entry (it reacts to nothing) and no `declares` entry (it
  performs no relationship copy, so any path id would be a lie). Its only entries on the shared
  object are `order` and the `debugButtons` it reads. **Each of those absences is the rule being
  followed, not an omission** — its own suite pins all three together so a later edit cannot quietly
  add one, and that is worth copying for the next plugin in this shape.

- **A bulk-only plugin takes leases and registers no `respecters` entry.**
  `CustomFieldsBulkEditor` is the first of those: it never reacts to a save, so it has nothing to
  stand down. Registering anyway would be a claim a sibling's dialog repeats to the user ("it will
  stand down") and it would be false — worse than silence, which the other side already reads
  correctly as "too old, or not listening".

  **Wrapping `window.fetch` is not what decides this — reacting to a write is.** That plugin was
  described here as one that "never wraps `window.fetch`", and at its 0.8.0 it does: it filters
  Stash's own `Find*ForSelect` responses so that a marked entity is not offered in an add
  dropdown. It still registers nothing, because it changes what a *read* answers and never acts on
  anyone's mutation. A plugin that stood down there would stop filtering dropdowns while a sibling
  ran a bulk task, which is unrelated to anything a lease is about.

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

**Neither is `declares` what the `api` registry replaced.** That one is about two plugins doing the
*same* relationship copy, where the answer is "you are both doing it, here is a note in your log";
the API is about one plugin doing the *other's* operation, where the answer is to stop having a
second implementation. A plugin can legitimately be in both: `declares` is a claim, `api` is a
service.

**`NormalizeParentTags` declares nothing.** It has no relationship-copy paths to publish, so its
`coop()` gained the `declares` field only for shape-consistency across all three plugins' shared
object — nothing reads an absent entry as anything other than "declares nothing", the same way
`respecters` already treats an unregistered plugin.

## Cross-plugin cooperation: one plugin computing another's operation

The newest of the shared mechanisms and the only one that is a *call* rather than a flag.
`coop().api[<pluginId>]` holds whatever a plugin is willing to answer for another; today
`NormalizeParentTags` publishes one entry (`prepare`, at its 3.2.0) and `TagBundleClipboard` is the
one caller (at its 0.5.0).

**It exists because the alternative was tried and documented before it failed.** That dialog offers
Prune and Roll Up, which are the other plugin's two operations, and it honoured that plugin's tag
exclusions by **copying the rules** — `splitTerms`, `nameMatchesAny`, `blockReason`, byte-for-byte,
the way `coopObject` and the CSS are copied. That is right for a shape and wrong for a *decision*:
a filter added on one side is silently not applied on the other, and the copy cannot know. The
copy even grew a scan that named any exclusion setting it did not recognise, so a newer sibling
could not drift past unnoticed — and **that scan working as designed is the argument against the
whole approach.** A plugin whose best answer to "are my rules still yours?" is a list of things it
could not check should stop guessing and ask.

**When to reach for this rather than another copy.** Copy a *mechanism* — the lease helper, the
dialog CSS, `plural` — because there is no build step and the alternative is a module this repo does
not have. Call an *owner* when the thing being duplicated is a decision that plugin's settings can
change: exclusion filters, what an automatic mode covers, anything a user configures over there and
expects to hold everywhere. The test is whether a future release of the other plugin can make your
copy wrong without either plugin being edited.

Four properties, and each one is a decision the next API here should repeat:

- **Resolve to a bound worker, not to an answer.** `prepare(opts)` returns a Promise of an object
  whose `plan(...)` is **synchronous**. A caller drawing a list re-plans on every tick as the user
  ticks boxes, and a checkbox that had to await a round trip would be worse than no feature. The
  publisher reads its settings and its hierarchy once, through the caches it already had.
- **Publish questions, not settings.** `autoMode` answers `'prune'`, `'rollup'` or `null` for an
  entity type — what the publisher will do by itself on the next save. Today that is two toggles
  scoped by a per-type switch; the day it becomes a mode per type, every caller keeps working. A
  caller reading the setting keys directly breaks that day *while sounding confident*, which is the
  whole reason the mechanism is a function call.
- **One options object per call.** A field can be added without a new signature, which is what lets
  a reserved parameter exist at all. Two are already there for a caller that does not exist yet.
- **`version` is a floor for a log line, not a handshake.** Callers feature-detect
  (`typeof api.prepare === 'function'`); the number is so a dialog can say *"the copy running here
  is older than 3.2.0"* rather than *"something is missing"*.

**A caller with no publisher does without, and says so.** There is no fallback to a local
approximation — that is the thing being deleted. `TagBundleClipboard` hides both modes and names the
version to upgrade to, which is a worse experience than a stale copy exactly once and a better one
every time after.

**`respecters` is still what says the publisher is *there*.** The `api` entry says it is new enough
to be asked. Those are different questions and both dialogs distinguish them in their logs.

**Testing it needs both halves, and one of them is an integration test.**
`tests/normalize-api.test.js` pins the contract from the publisher's side; `tests/tagclip.test.js`
loads the real publisher into the same `vm` context as the caller and answers both plugins'
queries from one fixture, so what reaches the caller's UI is the publisher's own code. A fake
planner would have tested a fake. Neither suite alone proves the pair works.

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
third plugin to slot in without renumbering either existing value. `TagBundleClipboard` is that
third plugin and took **5**, which is the gap being used as intended: its two buttons are the most
casual pair in the repo — one copies to a clipboard, one opens a picker — so furthest from
Save/Delete is where they belong, and no existing number moved.

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

## Cross-plugin cooperation: the shared debug switch

The smallest of the shared mechanisms, and the only one that changes no behaviour.
`coop().debugButtons`, set from the browser console (`__GTTx__.StashPluginCoop.debugButtons = true`), turns
on a `[<prefix>] gate` channel in every plugin that draws a button into these rows, explaining for
each button whether it is shown or hidden and why. Read at call time, so it takes effect on the
next tick with no reload, no setting and no file edit.

**One switch rather than one per plugin, for the same reason the ordering protocol is shared:** the
buttons sit in one row, and "why is this button missing" is rarely a question about only one plugin.
A user debugging a row wants both sides talking, not to discover a second flag afterwards.

**It covers any control a plugin draws into Stash's chrome, not only a button in those rows.**
`CustomFieldsBulkEditor` answers to the same flag for its list-view menu item — the name
`debugButtons` is now narrower than what it does, and renaming it would strand every user who has
the old name written down for the sake of a word. A plugin whose control has *one* place to fail
still uses it: the whole point is that a user types one thing.

**On the shared object rather than a plugin setting.** A setting would need a manifest key, a
storage slot, a settings-page row and a version bump in three files, to expose a diagnostic aimed at
whoever is already in DevTools looking at the console. It would also persist, which is exactly wrong
for a flag whose natural lifetime is one debugging session.

**Two shapes, and the distinction is load-bearing.** A short line fires from the probe every time
one runs, because a probe runs once per entity and again after every save that invalidates it, and
seeing that is the point — it says the re-check happened. Everything else is deduplicated per
channel and emitted from the *tick*, because the ticks that draw buttons run every second and on
every DOM mutation burst; undeduplicated, one open page would emit the same handful of lines
forever. Turning the flag off clears the channels, so switching it back on restates the current
position rather than staying silent until something moves.

**The per-button outcome has to come from the tick, not from the probe that computed it.** This
shipped the other way round and was wrong within a day of live use: the outcome lines fired from the
probe's callback, and a probe runs *once per entity*, so someone who switches the flag on while
already looking at the page whose buttons they are asking about gets the structural lines and no
outcome at all. That is not an edge case — it is how anyone actually turns a debug flag on. The
eligibility answers are cached, and **a diagnostic that only speaks when a cache misses is silent
exactly when it is wanted.** Both plugins now keep enough on the cached answer to restate the reason
without re-querying: `has` beside `adds` in `PropagateTagsAndPerformers`, `reaches` beside `carries`
on its source side, a `why` string on `MergePerformerTagsToScenes`' two check slots.

**Report "nothing to place" before "nowhere to place it".** The same live paste showed a Scene with
its Edit tab open reporting no detail navbar for a *source* button, on a page where no enabled path
reads from a Scene at all — a complaint about a missing container for a button that was never going
to exist. `manualSourceButtonsTick` now filters candidate paths first and looks for the container
second; only the dedup half of that filter needs a container, which is why the two were one pass
before.

**It is not the plugins' user-facing logging.** Those settings (`g1LogToConsole`,
`d1LogMergesToConsole`) narrate what a run *changed*, are meant to be left on, and go to a different
prefix. This narrates what the UI *decided*, and nothing in it is about the library.

## Cross-plugin cooperation: one colour for "a plugin wrote this"

A fifth shared convention, and the only one that is purely visual. Every button these plugins draw
into a page, and every task button Stash renders for them, is **`btn-warning` (amber)**; a control
that only reads is **`btn-info` (teal)**. Four settings toggles are recoloured to match — the ones
that make a plugin write without showing a plan first are amber, and the console-logging ones teal.

**Why not `btn-secondary`, which is what all of these were until
`NormalizeParentTags` 1.8.0 / `MergePerformerTagsToScenes` 1.17.0 /
`PropagateTagsAndPerformers` 0.17.0.** Stash's own row actions are `btn-secondary`, so a plugin's
button sitting among them was indistinguishable from one of Stash's — and the two are not the same
kind of thing. Stash's row buttons write what is in the form in front of you; these reach out and
rewrite *other* entities, often many of them. The note below still governs *where* the button goes,
and it still holds that ours are casual rather than primary: amber is not `btn-primary`, and Save
keeps the row's primary role.

**Pinned to the same string in every plugin.** `PLUGIN_BTN_VARIANT` is declared near the top of each
file, like the CSS strings and for the same reason: two plugins' buttons share a row, and one amber
beside one grey would read as a difference in kind rather than in plugin. `tests/placement.test.js`
covers the task-button case; the manual buttons are covered by the same suite's existing checks.

**A Bootstrap variant class, never a colour of our own.** The variant brings Stash's hover, focus
and active states with it. A `background-color` in a plugin's CSS would have to restate all three
and then keep them in step with the theme.

**Two live facts about Stash's theme, from a user's own instance, 2026-08-11.** Neither matches
stock Bootstrap, and neither is derivable from this repo:

- **`btn-warning` renders white text**, not Bootstrap's dark `#212529`. So nothing here sets a
  foreground colour, and the usual warning about amber being unreadable on a dark chrome does not
  apply to Stash.
- **`btn-dark` is themed identically to `btn-secondary`.** It is worth knowing and not worth using:
  it would read as no change at all.

**The settings toggles are CSS, not a class swap** — a Bootstrap switch has no variant classes, so
the colour has to be written. Two shapes per rule, because the switch is Stash's to render:
`#plugin-<id>-<key>:checked ~ .custom-control-label::before` is the track of the react-bootstrap
`Form.Switch` it renders today, and `accent-color` on the input covers a plain checkbox if that ever
changes. Whichever is not in use costs nothing.

The `#plugin-<id>-<key>` id is Stash's own, built by `SettingsPluginsPanel.tsx` — the same anchor
`settingElement` uses, and the one thing on that page that is ours by construction. The **key half
is the storage key**, so renaming a setting drops its colour silently along with everything else
renaming one drops; `tests/style.test.js` checks every such selector against the plugin's own `.yml`.
It deliberately does *not* pin *which* settings are coloured — that is a judgement per plugin, and
pinning the list would make every new setting an edit in two files for no gain.

**Marking everything would mark nothing.** Only the settings that write on their own are amber. The
entity toggles, the path toggles and the exclusion filters all stay Stash's blue, because they
choose what a run covers rather than starting one.

## Cross-plugin cooperation: one name prefix

A sixth shared convention, and the only one the user reads before installing anything. Every
plugin in this repo is named **`ᝯㄝₓ <name>`** — `ᝯㄝₓ Normalize Parent Tags`,
`ᝯㄝₓ Merge Performer Tags To Scenes`, `ᝯㄝₓ Propagate Tags and Performers to Related Entities`,
`ᝯㄝₓ Custom Fields Bulk Editor`, `ᝯㄝₓ Tag Bundle Clipboard`. There has been a prefix since `NormalizeParentTags` 2.0.0 /
`MergePerformerTagsToScenes` 2.0.0 / `PropagateTagsAndPerformers` 1.0.0 (and from its first release
for `CustomFieldsBulkEditor` and for `TagBundleClipboard`); it was the ASCII `GTTx ` until `NormalizeParentTags` 3.0.0 /
`MergePerformerTagsToScenes` 3.0.0 / `PropagateTagsAndPerformers` 2.0.0 /
`CustomFieldsBulkEditor` 2.0.0. Stash's plugin list is one flat alphabetical column of every
plugin installed, from every source; the prefix is what collects them in it and says they
are one author's, which matters here because they cooperate through the mechanisms above and are
meant to be installed together.

**A new plugin is named this way from 1.0.0 rather than renamed into it later.** The prefix costs a
major version only when it replaces a name people already matched on; `CustomFieldsBulkEditor` had
no such name, which is why it is the one plugin here whose major digit says nothing about a rename.

**The name is a display string; the id is the contract.** `PLUGIN_ID`, the folder, every setting
key, every `plugin-<id>-<key>` element id, every `coop()` key and every path id in `declares` are
untouched by the prefix, which is why the rename costs a user nothing: settings survive it, and a
prefixed plugin still cooperates with an unprefixed sibling. What *does* move with the name is
every place a plugin matches Stash's own markup by heading text — `ownSettingGroup`, `ownTaskName`,
`headingIsOurs` — so all three files change together or a plugin stops finding its own settings
group. That is what earns the major version bump: nothing behaves differently, and everything that
matched on the old string has to be re-pointed.

**`PLUGIN_SHORT_NAME` carries the prefix too**, since its whole job is to be the name a dialog head
wears and a head that dropped the prefix would read as a different plugin from the settings page
that configures it. `ᝯㄝₓ ` is four characters and buys the recognition; shortening happens in the
*rest* of the name, which is why `PropagateTagsAndPerformers` is the only one whose two constants
differ.

**Anything a plugin writes into a namespace it shares with the user takes a prefix too.** A custom
field is the case this repo has: `CustomFieldsBulkEditor` marks its description-store tag with a
field of its own, and until its 2.0.1 that field was `cfbe_desc_store` — a name any other plugin, or
any user, could have picked, in a flat namespace with no owner. It is
`ᱜ╦╦🞮_🛂🧲_🛠🛈🖫_desc_store` now, underscored rather than spaced because it is a key rather than a
display string, and the old name upgrades itself silently the first time a store wearing it is
found. The same plugin's hide-from-add-lists field went with it (`Exclude_from_add_list` →
`ᱜ╦╦🞮_exclude_from_add_list`), and that one is a *setting*: the upgrade rewrites the setting and the
one mark the store tag wears to hide itself — which nothing else can reach — and leaves the entities
to the Migrate button that plugin already had, because a name change must not start a bulk write on
its own. This is not the display prefix and it is not `__GTTx__`; it is the same reasoning applied to
the third place these plugins can collide with something that is not theirs.

**A sibling named in prose is named as the user will see it.** `SIBLING_NAME` / `NPT_NAME` — the
strings the cross-plugin warnings print — carry the prefix, because their entire purpose is to send
the user to a settings group they then have to find. The *id* those checks look the sibling up by
is unchanged, so a warning about an older, unprefixed sibling still fires; it names the plugin by
its current name, which is the one worth going to look for.

**A rename half-applied fails differently in each plugin, and three of the four fail invisibly.**
The `ᝯㄝₓ ` rename went into the four manifests a session before the four scripts, and the report
was that one plugin's settings page had stopped formatting. What was actually true: the three
plugins that reach their own settings group through the `plugin-<id>-<key>` ids looked untouched
(the ids are built from the plugin **id**, which no rename moves, and the heading is only their
fallback), `CustomFieldsBulkEditor` — whose only route in is the heading — decorated nothing, and
**all four** lost their task buttons, since `ownTaskName` compares the group's h3 against
`PLUGIN_NAME` in every one of them and has no id route anywhere. So: change `.yml`, `manifest` and
`.js` in the same edit, and when checking a rename landed, look at **Settings → Tasks**, not only at
Settings → Plugins — the settings page is the half most likely to look right while the name is
wrong.

**This rename shipped without a README release-note block, at the user's call**, and the rule above
("Only a major version earns a release-note block") is permission rather than obligation. A prefix
change costs a user nothing to act on: the ids carry the settings across, and the one genuinely
useful warning — half-updated folder, silent settings page — belongs in
`CustomFieldsBulkEditor`'s Troubleshooting, where it now is, because it is a fact about the plugin
rather than about a version.

## No write without a plan in front of it, and "..." says which

Two rules that arrived together at `NormalizeParentTags` 1.9.0 / `MergePerformerTagsToScenes` 1.18.0
/ `PropagateTagsAndPerformers` 0.18.0, because the second is only useful once the first is true.

**Every deliberate write a user starts is either staged or reviewed.** The tasks always had the
review dialog; the manual buttons did not. `MergePerformerTagsToScenes`' performer button merged
into every scene a performer appears in, and its scene button merged the scene outright whenever
staging was unavailable; `PropagateTagsAndPerformers`' target buttons wrote on "save immediately",
and its source buttons — the widest write here, one click on a studio rewriting every scene it owns
— always did. So the same dialogs now open **scoped**: one performer, one scene, one entity, or
whatever one source reaches, with the same Proceed / Stop / Copy log / Rescan / Undo footer.

**Scoped means the same planner over a named set, never a second one.** `Run`/`TaskRun` gained a
`scope`, and each plugin routes it into the code the library walk already used —
`reviewPerformer`/`planScene` in `MergePerformerTagsToScenes`, `planPass` (borrowed back from
`AutoRun`) in `PropagateTagsAndPerformers`. What a button shows is by construction what the task
would have shown for the same entity, and what the click used to write blind. The scope lives on the
run rather than in the call that started it, because **Rescan re-enters `begin()`** and a rescan of a
scoped run has to stay scoped.

**The automatic modes are untouched.** They write without a dialog by design, are opt-in per mode,
and say so in their own settings descriptions. This rule is about what a *click* does.

**"..." on a caption means the click asks before it acts.** The five task buttons Stash renders from
`tasks:` carry it, and so does every manual button that opens a dialog. A staging button does not:
it puts the additions in the form in front of you and Stash's own Save is the next step. Two
consequences worth knowing:

- **The caption is resolved per tick, not at build time**, wherever the behaviour depends on a
  setting (`stagingActive()` here, `savesImmediately(s)` there) — otherwise flipping the setting
  leaves a button promising a dialog it no longer opens. Both plugins hold the intended caption on
  the element (`_cpt2sLabel` / `_ptp2reLabel`) rather than reading `textContent`, which a click
  overwrites while a flash is in flight.
- **The cross-plugin dedup compares with the dots stripped.** Two plugins' buttons for one path
  match on visible text, and each side appends "..." on its own conditions, so a sibling staging
  where we review would otherwise read as a different button and both would appear.

**A dialog is its own feedback, so the button does not flash under it.** Where a click used to end
in "Added 3", it now restores its caption immediately: the modal covers the row, and a caption
restored two seconds into a review nobody can see is worse than none.

**An icon does not stand in for the dots.** `TagBundleClipboard` shipped `📋 Tags` for one release
on the argument that a caption already built around a pictogram has no room for a third token
reading as punctuation, and it is `📋Tags...` again a release later. The two marks answer different
questions: an icon says what the button is **about**, and the dots say what pressing it **commits
to**. Its copy button is `⮺ Tags` with no dots — not because of the icon, but because the click acts
immediately and writes nothing, which is the same rule every other caption here follows.

**And the dots come straight back off in the title** (`MergePerformerTagsToScenes` 1.18.1 /
`PropagateTagsAndPerformers` 0.18.1), which is not a contradiction: "..." is what a *caption*
promises, and a title quotes the caption inside a sentence, where trailing dots are just punctuation
in the middle of one. Both plugins strip them with the same one-line `stripEllipsis` that the
cross-plugin dedup was already using for its comparison.

**A scoped title names the entity, and a dialog gets a name short enough to leave room for it.**
Both shipped as `<plugin> - <caption>... - Group 57` and every part of that was working against the
next: the manifest name is the longest and least informative third, and the id is the one thing
about the entity the user cannot recognise. So:

- **`PLUGIN_SHORT_NAME`, declared beside `PLUGIN_NAME` in every plugin that puts up a dialog.** The
  manifest name cannot be shortened in place — `ownSettingGroup` finds a plugin's block on the
  settings page by matching that heading — so the short one is a second constant, and it is
  perfectly fine for it to be the *same string* where the name already fits (it is, in both
  `MergePerformerTagsToScenes` and `NormalizeParentTags`). The constant is what makes every head
  read from one expression — including `NormalizeParentTags`' two, the run dialog's and the
  hierarchy viewer's, which is reason enough to declare it in a plugin that never shortens.
- **A `scopeLabel` that reuses whatever the plugin's log already calls an entity**, never a second
  naming convention. One by-id query per scoped click, made while a dialog opens on a scan about to
  make dozens, falling back to the bare label and id rather than rejecting — a dialog that cannot
  name its scope should still open.
- **The direction word is the copy's**: `from` where the click pushes out of the named entity,
  `for` where it pulls into it.

**The title is a plain block in all three plugins, so it wraps rather than clipping.** That is the
default holding rather than a rule, and it only holds while nothing in a plugin's CSS makes
`.<prefix>-title` a flex child or sets `white-space` on it. It is now a default worth not breaking.

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

**Ask the page what it is before reasoning about what to do with it.** Twice in two rounds, a single
`getComputedStyle` dump from a live Stash replaced a multi-round guess: once for the missing
`.delete` class above, and once for row spacing, where `.edit-buttons` turned out to be
`display: block` — so the `row-gap` both plugins were setting had been inert on three of the four
edit pages since it shipped, while flex `.details-edit` spaced correctly from the identical call.
Neither was findable by reading the plugins' own code, and both looked exactly like a fix that had
"not worked" rather than a mechanism aimed at the wrong property.

The snippet that settles most of it, worth pasting into a report rather than iterating on a guess:

```js
['.edit-buttons', '.details-edit'].forEach(sel =>
  document.querySelectorAll(sel).forEach((el, i) => {
    const cs = getComputedStyle(el);
    console.log(sel, i, { display: cs.display, rowGap: cs.rowGap, alignItems: cs.alignItems });
    [...el.children].forEach(c => { const s = getComputedStyle(c);
      console.log('   ', c.tagName, JSON.stringify(c.textContent.trim().slice(0, 30)),
        s.marginTop, s.marginRight, s.marginBottom, s.marginLeft); });
  }));
```

**Where a value has to match Stash's, read Stash's rather than naming one.** Its buttons in
`.edit-buttons` carry `margin: 0 10px 0 0`, and 10px is not a step either plugin's utility classes
can express (that Stash's root is 14px, so `mx-1` is 3.5px, `mx-2` is 7px) — so any class produced a
gap that matched nothing. Both plugins now copy the computed margins off a button Stash put in the
row, found by its lack of a `_coopOwner`. A rule that reads the row cannot be wrong about a row
nobody has measured, which matters here because `.details-edit`'s own convention still has not been.

**A measured value still has to win the cascade — Bootstrap's spacing utilities are `!important`.**
The copy rule above shipped at 0.12.3 / 1.15.3 and changed nothing on the page, because both plugins
were still building their buttons with `mx-1` / `mx-2` and a Bootstrap `mx-*` outranks any inline
`margin-left` / `margin-right`. The tell was that the *same* `cssText` assignment worked in one axis
and not the other: `margin-bottom`, which no utility class here sets, visibly fixed wrapped-row
spacing in that same release while every horizontal gap stayed exactly as it had been. **One
declaration landing and its neighbour not is a specificity problem, not a wrong value** — check what
else is setting the property before re-deriving the number.

The fix is that the spacing class is no longer on the button at build time. `applyButtonSpacing`
adds it back, and only on the branch that has nothing to measure — so the class and the measurement
can never both be in play. Three cases, in order: a container that spaces its own children with
`column-gap` (ours inherits it, so any margin of ours would be *added* to the row's spacing rather
than match it) gets nothing; a row with a donor gets the donor's margins; a row with neither gets the
class. A donor is any element carrying `btn` without a `_coopOwner` — not just `<button>`, since
Stash styles some row actions as links, the same fact `findActionByLabel` already had to absorb.

**A measured gap is true of one instant; a margin is true whenever you ask.** This was tried the
other way round first, and it is the one lesson here that reverses an earlier one. Reading the
*neighbour's* `margin-right` answers "what is that element set to", not "how far apart are these
two" — so where a gap comes from something else, topping it up double-counts, which is what happened
on Group. `getBoundingClientRect` answers the real question, and it was wrong anyway: these rows are
still settling when a button is inserted into them, so the margin derived from one measurement
described a layout that no longer existed by the time anyone looked. Live, buttons ended up flush
against Delete on every `.details-edit` page. **Do not derive a persistent style from a transient
measurement.**

**The failure told us what the real problem was, though: the DOM sibling beside a button is not the
action the user sees.** React wraps some row actions — a file input beside its button, a dropdown
beside its toggle — and the wrapper carries no margin while the button inside it does. Resolve
through it: the last `.btn` inside the element before yours, the first inside the element after,
summed with the wrapper's own margin. Structural, no layout consulted, same answer every time.

**A zero read off something you cannot identify is not evidence of a zero gap.** The wrapper fix
above sorted Group's *edit* row and left its *detail* row doubled exactly as before, because that
row has the same mistake in a second form: the element beside the button holds no action at all —
an empty slot where a conditional one would go. Resolving *through* it finds nothing, so its own
absent margin was still being taken for the whole gap, and the real one (from the button behind it)
was added on top. Walk *past* such an element to the nearest thing that is recognisably an action,
adding the skipped elements' own margins on the way; assume they have no width, since width is the
one quantity here that cannot be had without a layout that has not settled. There are then three
answers per side, and they are not the same answer: **an action found** tops the margin up to the
row's step; **elements present but nothing recognisable** adds *nothing*, because guessing is
precisely what doubles a gap; **nothing at all on that side** means the button is at that end of
the row, where the row's own end margin is the whole story.

The arithmetic is what pins a bug like this, before any DOM is inspected. Group's detail row was
correct when the plugin set `margin-left: 0` and doubled when it started adding a step — so the gap
exists without the plugin, and whatever the plugin measured reported zero. That narrows the cause to
"the thing being measured is not the thing making the gap" without needing to know what the element
actually is.

**Test the donor scan with a positive length check, not `!== '0px'`.** A style engine with no
stylesheet loaded — jsdom, in the `placement` suite — reports `''` rather than `0px` for an unset
margin, which an inequality reads as "worth copying" and then applies as `margin-left:;`: nothing at
all, with the class fallback already skipped. That is a live-page hazard too, wherever a row's
buttons genuinely carry no margin.

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
`MergePerformerTagsToScenes`, `CSS` in `PropagateTagsAndPerformers`, `CSS` in
`CustomFieldsBulkEditor`, `CSS` in `TagBundleClipboard`.

**The settings-page rules are two halves, and only one of them is optional.** This shipped as one
list waived wholesale for a plugin with no `settings:`, on the reasoning that Stash renders no group
for such a plugin. That reasoning was wrong about the half that matters most: **every plugin gets a
group, a heading and a description**, whether or not it has anything to configure, and the
description is the first thing a user reads before installing. So `tests/style.test.js` splits them:

- **`DESCRIPTION`** — `.own-group .sub-heading`, `.desc-collapsed .p:not(:first-child)`,
  `.desc-toggle`. Required of **every** plugin here. This is the summary-plus-**Show more** design,
  and `CustomFieldsBulkEditor` 0.1.0 is when the fourth plugin stopped being the exception to it.
- **`SETTING_TIPS`** — `.tipped`, `.tip`, `.tipbox`, `.tipped.tip-open .tipbox`. The per-*setting*
  hover box, so only a plugin with setting rows can have one. `CustomFieldsBulkEditor` carried a
  `settings: false` flag until its 0.7.0 gave it a first setting, paired with a check that such a
  plugin declares no settings *and* defines none of these — or the flag would be excusing a drift
  instead of recording an absence. All four carry the rules today; the flag is kept for the next
  settings-less plugin, a shape this repo has had twice.

**A settings-less plugin has no `plugin-<id>-<key>` ids to anchor on, so the heading is its only
route in** — and a plugin whose only id sits in a *setting row* is no better off when what it has to
find is the group header's own description, which is why `CustomFieldsBulkEditor` still enters by
the heading at 0.7.0. Every other plugin here finds its group through those ids and keeps `headingIsOurs` as a
fallback, precisely because two of them shipped broken twice on heading text. `CustomFieldsBulkEditor`
has that fallback promoted to the only route, which is why its `headingIsOurs` compares **exactly**
rather than by prefix and why `tests/cfbe.test.js`'s fixture carries the version suffix Stash
appends. It is the one anchor in this repo with nothing behind it; treat it accordingly.

**Escape closes every dialog, through the footer rather than around it.** Added at
`NormalizeParentTags` 2.1.0 / `MergePerformerTagsToScenes` 2.1.0 / `PropagateTagsAndPerformers`
1.1.0 / `CustomFieldsBulkEditor` 0.1.0, and duplicated byte-identically in all four like everything
else here. `escapeButton(run)` returns whichever of `closeBtn`/`cancelBtn` is currently **visible
and enabled**, and the key clicks it; a null answer does nothing. That indirection is the whole
design: the footer is the dialog's own statement of what it will let you do right now, so the key
can never reach a button that is hidden or disabled — and in particular does nothing **mid-write**,
where both are hidden and Stop is the only way out. A key that quietly abandoned a run in flight
would be worse than one that does nothing. The listener goes on `document` (the modal is not
focusable, so a click into a log or an input would otherwise put the key out of reach) and is
removed in `close()`, which is why `tests/npt-harness.js` implements a real `removeEventListener`
rather than a stub — a no-op there would let a closed dialog go on answering the key with every
check about it still passing.

**"Back up your database before proceeding." is now "Backing up your database before proceeding is
recommended."**, in all four writing dialogs' heads, at the user's request. The sentence after it is
unchanged and still states what Undo cannot reach — own writes, open dialog, blind to concurrent
changes. This is a change of register, not of advice: it is still the first line of every head, and
the standing rule that the backup instruction must not be edited out for brevity (§1 of
`NormalizeParentTags`' CLAUDE.md) is unaffected.

**And there is now one dialog that must not carry it at all.** `TagBundleClipboard`'s picker issues
no mutation: it puts tags into an edit form and Stash's own Save commits them. Telling that user to
back up first would be false, so its head says where the tags actually go instead. **The rule above
is about dialogs that write.** It has never been a rule that every head carries the sentence regardless of whether the
dialog can change anything, and the distinction only became visible when a plugin arrived that
cannot. Before waiving it for a *new* dialog, check the same thing the suite checks for that one:
that no path in the plugin issues a mutation. A dialog that writes and skips the sentence is the
failure this rule exists to prevent.

**Keep the overlapping rules byte-identical.** They drifted once — the modal was `#202b33` in one
and `#30404d` in the other, with a `font-size` and a `z-index` to match — because the second dialog
was written a day after the first and nobody compared them. `tests/style.test.js` parses all five
strings, strips the `npt-` / `cpt2s-` / `ptp2re-` / `cfbe-` / `tbc-` prefixes, and fails on any
selector two or more of them define differently.

**It works, and the fifth plugin is the evidence.** `TagBundleClipboard` was written with a `.panes`
and a `.tall` of its own, and the suite failed on both the first time it ran. The two resolutions
are opposite and the reason is the same one: **a class name two plugins share has to mean the same
thing in both.** `.tall` *is* the same thing in both — a modal whose content changes while the user
reads it and must not resize under the pointer — so the newcomer took `CustomFieldsBulkEditor`'s
88vh and dropped its own 70vh. `.panes` is not: one is a padded two-column body, the other a
divided one, so the newcomer renamed its own to `.cols` rather than forcing two layouts to agree.
Pick by what the rule *means*, never by which plugin got there first.

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

**The modal has no `height`, only a `max-height`, and that is a decision with a known edge.** It
sits in a centring backdrop, so it is content-sized: it grows with its log to the cap and shrinks
back when there is less to show. For a dialog that is a head, a log and a footer that is right.
It is wrong for a dialog whose content changes while the user is reading it — a filter narrowing a
listing, or a resizable box being dragged — where the window moves under the pointer.
`CustomFieldsBulkEditor` 0.10.0 hit both and answered with `.cfbe-modal.cfbe-tall{height:88vh}`, a
plugin-local **modifier**, leaving the pinned rule untouched. That is the pattern for anything in
this category: the shared rule is the floor, and a plugin with a reason adds a class of its own
beside it rather than editing what three other plugins are also using.

**`width:min(100rem,94vw)` is the modal width**, raised from `56rem` to `80rem` and then by another
quarter at the user's request, each time across all four plugins in one release
(`NormalizeParentTags` 2.2.3 then 2.2.4, and its siblings alongside). It is one of the pinned
overlapping rules, so it is not a per-plugin judgement: these dialogs hold monospace log lines that
name an entity, an id and two values, and the wrap they were taking at 784px was the complaint. The
`94vw` half is what keeps it honest on a narrow window and is the reason the change is a one-token
edit rather than a layout question.

**The log stays until the dialog closes, in all four** (`NormalizeParentTags` 2.3.0 /
`MergePerformerTagsToScenes` 2.2.0 / `PropagateTagsAndPerformers` 1.2.0; `CustomFieldsBulkEditor`
never did otherwise, which is why it is the plugin the other three were asked to match). Three of
them emptied the rendered log on **Rescan** and kept only the export buffer, so a session read whole
solely through Copy log. They now write a `--- Rescan ---` line and the next pass carries on below
it — the marker is what makes the passes legible, and it was always logged; it was simply wiped a
line later.

**It deleted a counter rather than adding one.** All three carried `viewLines` beside `lines`
precisely *because* a rescan emptied the view: reporting the export buffer's length over an emptied
view produced a header claiming 28 161 log lines above four of them, and claiming to hide the
difference. With nothing emptying the view, `lines.length` is the only honest answer and the second
counter is gone. **A divergence maintained by two counters is worth checking for a third option: not
diverging.**

**A cursor cycles under the last line while work is in flight** (`NormalizeParentTags` 3.1.0 /
`MergePerformerTagsToScenes` 3.1.0 / `PropagateTagsAndPerformers` 2.1.0 /
`CustomFieldsBulkEditor` 2.1.0), in every dialog that has counters — `▙ ▛ ▜ ▟`, one four-frame
cycle at 2Hz. The counters answer *how far*; a run that spends seconds on one page of a large
library leaves *is it still going* unanswered, and a progress line that has not moved looks exactly
like a hung tab.

- **`state` is the only thing that decides**, so `spin(busy)` is one line at the end of each
  plugin's `setState` and nothing else turns it on or off. Every path in and out of a read or a
  write already goes through there, including the ones that end in a failure.
- **It is a sibling of the log lines, not one of them.** It carries `<prefix>-spin` and never
  `-line`, so nothing that reads the log back — the render cap, `dialog().lines`, a test counting
  rows — mistakes it for content. Whatever appends under it (a flush, a message, a listing block)
  moves it back to the end.
- **The interval is cleared in `close()` as well as by `spin(false)`**, because a dialog closed
  mid-write leaves no state change behind to switch it off.
- `.<prefix>-spin{color:#a7b6c2;}` is the log's own INFO grey, and it is one of the pinned
  overlapping rules — the same in all four.

**The footer order is shared too, and majority decided it** — `CustomFieldsBulkEditor` 0.7.1 moved
Apply from second-to-last to first, matching the three siblings' `Proceed · Cancel · Stop ·
Copy log · Undo · Rescan · Close`. The write is the leading button in all four now. There was no
recorded reason for the outlier: it was built before the three had converged, and "unless there is a
specific reason" is the user's own rule for harmonising. `CustomFieldsBulkEditor` has no **Stop** —
its writes disable the whole footer for their duration, so there is no state to press one in — and
the gap is simply closed rather than held open.

**Only that plugin's footer is pinned in a test.** Four copies of one literal would guard against a
drift that has happened once, on the one plugin that has now been corrected; pin the others if a
second footer ever moves.

**The *position* harmonised; the *caption* deliberately did not.** Three plugins say **Proceed** and
`CustomFieldsBulkEditor` says **Apply**, and that is the "specific reason" clause of the rule, not an
oversight left behind by 0.7.1. The two words name two different actions: the siblings enumerate
every change into the log first, so Proceed means *write the plan above*, and the button is disabled
until there is one. `CustomFieldsBulkEditor`'s log lists what the entities carry **now** — its
`plan()` runs inside `apply()`, on the click — so the press is the plan and the write together, which
is what Apply says and Proceed would misdescribe. It also pairs with the **Apply to** select beside
it, which is the control deciding what that one press covers. Do not rename either side for
symmetry; a shared word here would flatten a real difference in what pressing the button commits to.

## One verb per idea, across all five plugins

`MergePerformerTagsToScenes` and `PropagateTagsAndPerformers` labelled every one of their manual
buttons **Copy** — `Copy Tags to all Scenes...`, `Copy all Tags from all Performers`,
`Copy Tags from Studio`, twenty-odd captions between them. That was unambiguous while they were the
only two plugins here that moved tags. `TagBundleClipboard` made it ambiguous: it has an actual
clipboard, its copy button puts a bundle *on* that clipboard, and a row could end up holding two
buttons both saying "Copy" and meaning different things.

**Every one of those captions is now `Add`** (`MergePerformerTagsToScenes` 3.2.0 /
`PropagateTagsAndPerformers` 2.2.0). Three letters, the shortest of the candidates, and the only one
that is *true of both directions* — these paths only ever add, which is already the reason running
both plugins at once is never wrong. It reads correctly with either preposition the captions use:
`Add Tags to all Scenes...`, `Add all Tags from all Performers`. Import/Export needed two words and
a direction the caption already states; Propagate is long and describes the mechanism rather than
the effect.

**`Copy log` is untouched, in all five footers.** That button copies to the *system* clipboard,
which is what "copy" means everywhere outside this repo, and it is the one place the word is not
about moving metadata between entities.

**A caption rename is a minor, not a major.** Nothing here matches on those strings except the
cross-plugin dedup, which compares two plugins' live button text — and both plugins changed in the
same release, so the comparison still holds. The major digit is for a rename users have to *act* on:
`ownSettingGroup` and `ownTaskName` match on the plugin **name**, which is why the `ᝯㄝₓ ` prefix
cost one and this does not.

## A README describes the plugin, not its history

**Only a major version earns a release-note block at the top of a README.** A major digit here means
a rename, a settings reset, or something else a user already running the plugin has to *do*
something about — that is worth interrupting them for before they read a word about what the plugin
does. A minor or a patch is not: the new behaviour belongs in the prose that describes the
behaviour, written in the present tense, where the person reading it is already looking.

**Where the feature goes is the test of whether the note was needed.** Every note removed in this
pass had a natural home in the body — the stale-script banner belongs under "Checking which version
is actually running", `CustomFieldsBulkEditor`'s belongs in Troubleshooting — and none of them said
anything there that the note had been the only record of. A release note that has nowhere else to go
is usually describing a *change* rather than the plugin, and that is the thing this rule is against.

**Nor in the middle of a sentence.** "since 0.13.0", "up to 0.12.14 the answer was computed and
thrown away", "(0.18.1)" — a changelog scattered through an explanation of how the plugin behaves
now, one parenthesis at a time. `PropagateTagsAndPerformers` had eleven of these and lost all of
them: the reader wants to know what it does, and every clause spent on what it used to do is a
clause they have to discard. Three shapes of version reference *are* kept, because each one is a
fact about today: a **requirement** (`Requires Stash 0.31.0 or newer`, `needs MergePerformerTagsToScenes
1.12.1 or newer`), the **plugin's own current version** where a file states it, and nothing else. A
sample console line takes `<version>` rather than a number, which is the same rule applied to an
example: the number in it was never the point, and a stale one reads as an instruction.

**This rule is about a plugin's `README.md` and nothing else.** `tests/README.md` keeps its
"since X.Y.Z" markers on purpose: it is the suite map, it does not ship in `files:`, and which
release a check was added for is exactly what makes `SRC=/path/to/old.js node tests/<suite>.test.js`
usable. Confirmed with the user when the rule was set.

**The reasoning still gets written down — in the plugin's own `CLAUDE.md`,** which is where a
per-version note has always belonged and which does not ship to users (`files:` carries the `js`,
the `yml` and the `README.md`). This rule moves nothing out of that file; it stops the same material
being kept twice, once for a reader who wants it and once for a reader who does not.

## Tests

`node tests/run.js` (or `npm test`) runs the suites in `tests/`. They evaluate a plugin inside a `vm` context holding a hand-rolled browser and drive it by answering its GraphQL requests — see `tests/README.md`.

Most of it needs no install. The `placement` suite needs `jsdom` and skips itself without it; `npm install` enables it. `package.json` exists only for this — it is not part of any plugin.

Tests cover the plugin's own logic and its assumptions about Stash's markup and component props. They cannot confirm those assumptions still hold after a Stash upgrade, so a change that touches Stash's DOM or components still needs exercising in a live Stash instance.

When fixing a bug, check the new test fails against the unfixed plugin before trusting it: `SRC=/path/to/old.js node tests/<suite>.test.js`.

## Two words this repo does not say: "Stash id", and "(s)"

**"Stash id" is taken, and it does not mean the local one.** In Stash's own vocabulary a *Stash ID*
is the identifier a **stash-box** (a metadata provider — StashDB and friends) assigns an entity;
it is what `stash_ids` holds on a scene or performer, and what "Submit to Stash-box" matches on. It
is not the number in the URL. Every dialog head, log legend and README here used to call the local
database id a "Stash id" — the number in brackets after a name — which read as a claim about a
provider that had never been consulted. They all say **id** now, plainly. The plural is `ids`.

**When a plugin here does start using the real thing, it is spelled `stash-id`, hyphenated.** No
plugin reads `stash_ids` today, so the phrase is currently absent from the repo entirely, and
`tests/style.test.js` enforces exactly that by searching each plugin's source for the string
`Stash id` — a check that only works while the correct term is spelled differently. The hyphen is
what keeps it working: `stash-id` / `stash-ids` never matches, so a plugin that legitimately shows a
stash-box identifier can say so without the guard against the old misuse having to be weakened, or
turned into something that has to distinguish the two by context. It also matches how `stash-box`
itself is written throughout, which is the term the id comes from.

**A count is known where it is printed, so print the word that agrees with it.** `3 scene(s)`,
`1 child(ren)` and `2 error(s)` were everywhere, and the parenthesis was never carrying information
— the number sits right beside it. Every plugin now holds one `plural(n, one, many)` (byte-identical
across the four, like `coopObject` and the CSS): it appends an `s` unless an irregular plural is
passed, so `plural(kids.length, 'child', 'children')` is the only call in the repo that needs a
third argument. This is about *generic* parentheses in generated text; a parenthesis quoting one of
Stash's own captions, or a regex like `/tag(s)?Update/`, is untouched.

## Reference: a list view's URL does not always name what it lists

Read off `stashapp/stash` `develop`, 2026-08-13, when `CustomFieldsBulkEditor` 0.1.1 fixed the four
places it was wrong. Any plugin here that decides what page it is on from the path needs this;
today only `CustomFieldsBulkEditor` does.

Most list views end in the plural of what they hold — `/scenes`, `/performers/12/scenes`,
`/tags/9/images` — which is why reading the last segment works at all. Five do not:

| URL | Lists |
|---|---|
| `/galleries/<id>` | Images |
| `/galleries/<id>/add` | Images |
| `/groups/<id>/subgroups` | Groups |
| `/studios/<id>/childstudios` | Studios |
| `/performers/<id>/appearswith` | Performers |

The mechanism, which is what makes the list predictable rather than a set of one-offs: a detail
page's tabs go through `useTabKey` (`Shared/DetailsPage/Tabs.tsx`), which puts the tab key straight
into the path as `<base>/<tabKey>` — so the segment is a *tab name*, and three of them are not the
plural of what the tab shows. `Gallery.tsx` is the exception to even that: it routes its right-hand
tabs by hand to `/galleries/<id>` and `/galleries/<id>/add`, so its images tab has no segment of its
own at all. All five render the same `Filtered*List` component as the top-level list, with the same
"..." menu and the same selection, so a plugin that works on one works on all of them once it can
name them.

**Match the whole path, not the tail.** `add` on its own is far too common a segment to map to an
entity type on sight.

## Reference: a row links to its own entity twice, and sometimes to a relative once

Read off `stashapp/stash` `develop`, 2026-08-13, when `CustomFieldsBulkEditor` 0.1.2 fixed a
selection being read short. Any plugin here that turns a selected row back into an id needs this.

**`GridCard` links the row's own entity twice** — `CardNavLink` at `props.url` wraps the thumbnail,
and a second one wraps the title — and every card in every list view is a `GridCard` (`grid-card`,
beside the type's own class). `TagListTable` and `StudioListTable` do the same with the image cell
and the name cell, in `<tr>`.

**Some rows also link to a relative of their own type, exactly once**: a tag card names its parent
tag, a studio card its parent studio, both as `/tags/<id>` and `/studios/<id>` — indistinguishable
from the row's own link by URL shape. Scene, image, gallery, performer and group rows have no such
link, which is why the bug looked like it was about two entity types rather than about rows.

So **the count is the signal**: within one row, the id with strictly the most links is the row's
own. **Only within one row** — across a container, a studio that is the parent of many others is the
most-linked id in the whole table, so counting there would resolve a select-all to one studio.

## Reference: custom fields in Stash

Findings from reading `stashapp/stash` `graphql/schema/types/*` on `main`, 2026-08-04. Verify
against the running Stash version before relying on any of it — this is a snapshot, not a contract.

**`CustomFieldsBulkEditor` is what came of this section**, and it acts on every line of it: the
seven types are its `ENTITIES` table, the two without a bulk input are the two it writes one at a
time, `partial`/`remove` are the only two inputs it uses, and "there is no way to query objects for
*whichever* custom fields they happen to have" is why it reads a **named selection** rather than
offering a key picker. Scene markers being absent from the seven is why it offers nothing on the
marker list, which is stated in three places because it otherwise reads as a bug.

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
