# CLAUDE.md — ᝯㄝₓ Scene Variants

Project-specific guidance for this plugin. The repo-wide conventions (ES5 IIFE, no build step,
`gqlRequest`, the shared `coopObject` / `domBus`, the settings-page description design, the `ᝯㄝₓ `
name prefix) are in `../CLAUDE.md` and still apply. The user-facing description is `README.md`;
this file is for the reasoning that does not belong in either. The design this was built from is
`../.plans/scene-variants.md`, which covers five further levels.

**The presentation was rebuilt once, before it had ever been seen working.** The first cut injected
a block of DOM under the scene page's tab strip; what was actually wanted was a *tab* — one more
entry beside Details, Queue, Markers, Group, Filter, File Info, History and Edit. The rebuild is a
net deletion, and §1 is why.

**Nothing here has been seen working on a live page yet.** The first live session got as far as the
sibling query being rejected outright — `invalid modifier INCLUDES for stash IDs criterion` — which
confirmed §2's field name and shape (the criterion parsed and reached its handler) and nothing else. `tests/scenevariants.test.js` is 20
checks against four mutants, and every one of them is a fact about the plugin's own logic — not one
of them can tell you the tab strip is where this thinks it is, or that `stash_ids_endpoint` is
spelled that way on the server in front of you.

## 1. A tab, and the three things that got deleted to build one

The plan's L0 was **a button** whose caption depended on the sibling count. That became a DOM panel
under the tab strip, and then — on the correction that "tab" meant a real one — a tab. Each step was
a deletion, and the last was the largest:

**Gone with the DOM panel:** `findTabStrip` and `hasEditPanelTab`, the `svr-panel` reconciliation
(build a panel, compare a content key, replace only on a change), `clearPanel`, the route regex, the
`domBus` subscription, the click and `popstate` handlers, and the two-query probe with its
single-entry cache and in-flight guard. Roughly two hundred lines, all of it machinery for putting
something back into a DOM React kept taking away.

**What replaced it is React's:** the tab and the pane are components handed to two extension points,
and React renders them, re-renders them and unmounts them. The pane's own state is one `useState`
and one `useEffect` keyed on the scene id.

**And the query halved.** `props.scene` is a `SceneDataFragment`, which already carries `stash_ids` —
so the plan's single-`findScenes` sketch in §4 turns out to be right after all. It was only ever two
queries because a DOM plugin starts from an id in a URL and has to ask who that scene is. A tab is
*handed* the scene.

The plan's `coop().order` of **15** is still the right number if buttons ever arrive, and the gap it
sits in is still open.

## 2. The extension points, and why there is no fallback

Read off `stashapp/stash`; `Scene.tsx` declares both, and they are in v0.28.0 and v0.31.1 alike:

```ts
const ScenePageTabs       = PatchContainerComponent<IProps>("ScenePage.Tabs");
const ScenePageTabContent = PatchContainerComponent<IProps>("ScenePage.TabContent");
```

A `PatchContainerComponent` renders `props.children` and nothing else. It exists to be patched.
Four facts worth not re-deriving:

- **`after(component, fn)` is invoked as `afterFn.apply(ctx, args.concat(result))`**, and returns
  the new result. **`args` is what React passed the component, which is not one argument.** React
  calls a function component as `Component(props, secondArg)`, and `secondArg` is the legacy
  context — `emptyContextObject`, `{}`, for anything declaring no `contextTypes`, which is
  everything here. So the callback is handed `(props, {}, result)`.

  This shipped as `function (props, result)` and threw on the first render:
  *Minified React error #31 — Objects are not valid as a React child (found: object with keys {})*.
  The `{}` was the context, rendered as a child. `patchResult(arguments)` takes the result off the
  **end**, where it is by construction, so it cannot be wrong about how many arguments came first.

  **The suite confirmed the bug rather than catching it**, because its fixture called
  `fn(props, result)` — the same assumption the code was written from. That is the repo's own
  standing warning about fixtures for someone else's markup, and it cost two releases: the fix was
  right and the *next* report was the same error from a cached script, which no amount of reasoning
  about the code could have separated from a second bug.

  So there is now `tests/scenevariants-render.test.js`, which supplies neither half: Stash's
  `PatchFunction` copied behaviour-for-behaviour, and the **real React 17** calling the patched
  component, so React decides what the arguments are. It reproduces the exact live error against
  the broken release and passes against the fixed one — which is how "the fix is right, the browser
  is running the old file" became something demonstrable rather than something to assert.

  **React 17 specifically**, because Stash's UI is on 17. Installed at 19 first, and there the same
  broken code silently drops the children instead of throwing — a newer React would have made the
  new suite agree with the bug as well.
- **The patch list is read when the component renders**, not when it is defined, so registering at
  script load is early enough however late `Scene.tsx` is imported.
- **`props.scene` is a `SceneDataFragment`** and carries `stash_ids` — see §1.
- **`activeTabKey` is a plain `useState("scene-details-panel")` with no whitelist**, so a key of our
  own is selectable exactly like Stash's nine. `TAB_KEY` sits in their namespace deliberately.

**There is no DOM fallback for a Stash without these**, and that is a decision rather than an
omission. A hand-built tab would have to reproduce activation, pane switching and every re-render
React does for free — a second implementation of the thing that was just deleted. An old Stash gets
one console line, and the README states the requirement.

## 3. The tab is always there, and carries no count

Two decisions that pull against each other, and both go the same way for the same reason: the strip
must not move.

**Always rendered**, including on the scenes — most of them today — with no stash-id and therefore
no possible sibling. A tab that appeared when a query landed would shift every tab to its left under
the user's pointer. And the empty cases are the ones worth explaining: "this scene carries no
stash-id" is a fact about the library the user can act on, and a tab that hid itself is the one
place it could never be said.

**No count in the caption.** The strip and the pane are two separate patches rendering two separate
components, so a count beside the word would mean sharing one query's answer between them — a
module-level cache and a subscription — to save the user one click. The pane counts its own rows in
its first line instead. A count would also have to *change* after the tab first rendered, which is
the strip moving again.

## 4. Four decisions in the pane that look arbitrary

- **Role outranks running time in the sort.** The pane's usual question is *which of these is the
  whole thing*, so a tagged full-length scene sits above a longer untagged rip. The suite's fixture
  makes the untagged sibling the longer file on purpose; without that, a duration-only sort produces
  the same order and the rank is untested.
- **An untagged sibling is listed with no role at all**, not with a guess and not with a warning. In
  a library that has not adopted the tags — or has not tagged this set yet — every row is in that
  state, and a column full of "unknown" would read as a broken plugin rather than as an unanswered
  question.
- **Both tags on one scene is red.** The two values are mutually exclusive by definition, so there
  is no correct winner to pick; the plan's §7 lists this as the first diagnosis and its L3 answer is
  "ask which", which needs a dialog this plugin does not have. Showing it is the whole of what L0
  can honestly do.
- **A wrong guess must lose the tab, not the page.** `safeAppend` searches *backwards for an
  element* rather than indexing, and wraps the build; either way out returns Stash's own render
  untouched. This is not speculative hardening — it is the failure that actually happened, and its
  blast radius was the entire scene view for a plugin that only reads. Indexing was wrong once
  already, and "the result is the last argument" is exactly the kind of by-construction fact the
  two arguments in front of it also were.
- **The settings are awaited before the rows are classified.** `settingsReady()` sits in front of
  the query rather than the pane reading `settings()` synchronously, because the pane reads them
  exactly once — on mount — and nothing re-renders it afterwards. Classifying half a second early
  against the empty defaults would be wrong for as long as the tab stayed open, and would look
  exactly like two tag names that do not match.

## 5. Unverified — the list a first live session empties

Everything in it is a guess about Stash that no test here can check:

1. **That the tab renders.** The patch points, the registration and the argument shape are all
   confirmed live now — the second render got as far as React rejecting a child, which means both
   patches were found, called and their results used. What has still not been seen is a tab on the
   strip.
2. **The pane's own CSS** against Stash's theme: the greys are the dialogs' greys, but no dialog in
   this repo sits inline in a tab pane the way this does, and the pane takes no background of its
   own.
3. **That a sibling set is ever found at all** — the query is right by construction now, and nobody
   has seen it return two scenes.
4. **Where the tab lands in the strip.** It is appended, so it should sit after Edit; whether that
   reads better before Edit is a judgement nobody has been able to make yet.

**Confirmed, and worth not re-deriving:** `stash_ids_endpoint` exists, is spelled that way and takes
a list (the live rejection came from inside its handler, so everything before the modifier parsed);
`EQUALS` is the modifier and over a list it ORs the ids; and omitting `endpoint` leaves it out of the
join condition rather than matching nothing, so one query does cover a set spanning two providers.

**`INCLUDES` was the wrong guess and it was a reasonable one**, which is why it is written down
rather than quietly fixed. Every other list criterion in Stash takes `INCLUDES` / `EXCLUDES`, so the
stash IDs criterion reads like its neighbours and is not: it accepts exactly `IS_NULL`, `NOT_NULL`,
`EQUALS` and `NOT_EQUALS`, and `f.setError`s on anything else. A filter field that parses is not a
filter field that runs, and the four-modifier whitelist is invisible from the schema.

**A failed sibling query is reported on the console whatever `b1LogToConsole` says**, and that is
the one place this plugin is deliberately noisy. Every other way of showing nothing — no stash-id,
no sibling — is a legitimate answer, and the three are indistinguishable to a user looking at a page
with no panel on it. Only one of them is worth a line.

## 6. Why there is no dialog, and what that cost in the suites

The plugin draws a tab pane and links. There is no backdrop, no log, no footer — so
`tests/style.test.js` gained a `chrome: false` flag beside its existing `settings` one, plus the
inverse check that a plugin claiming no dialog defines none of the chrome *and* names no backdrop of
its own in its source. That is the same shape as the settings flag: a flag recording an absence has
to be checked against the plugin, or it is excusing a drift.

The settings half of the shared design is **not** waived. Every plugin here gets a group, a heading
and a description whether or not it puts up a dialog, and the per-setting tooltip applies the moment
there is a setting row. Both halves are byte-identical to the siblings'.

## 7. The five shared mechanisms this plugin correctly does not use

No lease (it issues no mutation), no `respecters` entry (it reacts to no save), no `declares` entry
(it copies no relationship, so any path id would be a lie). `TagBundleClipboard` is the precedent for
those three. Two more are added here: no `coop().order`, because the ordering protocol is about
buttons sharing one of Stash's own action rows and this plugin draws no button; and **no `domBus`**,
because the shared observer exists to put a control back after a re-render and React is doing the
rendering. That leaves the settings page, which is decoration a one-second timer covers — exactly
the position `NormalizeParentTags` is in, and it is the second plugin here to subscribe to nothing.

What it *does* read is `coop().debugButtons`, on the same reasoning the name already stretched to
cover a list-view menu item: the flag answers "why is this control not there", and a tab is a
control.

## 7b. Two suites, and why neither is enough alone

The plugin no longer touches the DOM on a scene page, so a suite reading `document` would be reading
nothing. `tests/scenevariants.test.js` carries about forty lines of fake React — `createElement`
producing `{type, props, children}`, plus a `useState` and a `useEffect` over hook slots with a
re-render on `setState`. That is the whole of what the pane uses, and building it was cheaper than
the alternative on offer, which was to test nothing about the pane at all.

It also drives the patch callbacks the way `PatchFunction` does, and its fake React answers
`isValidElement`, because `safeAppend` refuses to append to anything that is not an element.

**That suite can only ever check what this plugin decides**, which is why the render suite exists
beside it. The division is worth keeping: the fake-React suite covers ordering, classification, the
empty answers and the effect keying — dozens of checks that would be miserable to write against a
real renderer — and the render suite covers the one thing a fake cannot be trusted on, which is what
React actually does.

## 8. Where L1 goes when it arrives

The title and shared-performer fallbacks are the plan's §5 L1, and the seam for them is
`findSiblings`' `if (!ids.length)` branch — today it returns an empty set with a reason sentence, and
that sentence is already what the pane's first line prints. A title-matched sibling has to be
*marked* as such in the row, since the confidence differs from an id match; the `cls` object each row
carries is where that goes.

The tab being permanent is what makes L1 land well: the scenes it will help are exactly the ones
looking at "This scene carries no stash-id" today, and they will not have to discover a tab that was
not there before.

With about two scenes in three carrying no stash-id in the user's library, L1 is worth more than
everything above it in the plan.
