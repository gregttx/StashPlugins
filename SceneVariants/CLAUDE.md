# CLAUDE.md — ᝯㄝₓ Scene Variants

Project-specific guidance for this plugin. The repo-wide conventions (ES5 IIFE, no build step,
`gqlRequest`, the shared `coopObject` / `domBus`, the settings-page description design, the `ᝯㄝₓ `
name prefix) are in `../CLAUDE.md` and still apply. The user-facing description is `README.md`;
this file is for the reasoning that does not belong in either. The design this was built from is
`../.plans/scene-variants.md`, which covers five further levels.

**The first live session found one thing and could not get far enough to look at the rest.** The
sibling query was rejected outright — `invalid modifier INCLUDES for stash IDs criterion` — so the
panel has still never been drawn on a real page. What that failure did confirm is §2's field name
and shape, since the criterion parsed and reached its handler; everything about the panel itself is
still a guess. `tests/scenevariants.test.js` is 20
checks against four mutants, and every one of them is a fact about the plugin's own logic — not one
of them can tell you the tab strip is where this thinks it is, or that `stash_ids_endpoint` is
spelled that way on the server in front of you.

## 1. What L0 is, and what it deliberately is not

The plan's L0 was **a button** whose caption depended on the sibling count — straight to the one
match, a picker dialog for several. The user asked for a **panel** instead, and the panel is
strictly less machinery for strictly more information: it answers the one-sibling case and the
many-sibling case with the same markup, so the picker dialog, the count-dependent caption, the
`"..."` convention, `insertBeforeImportantAction`, `applyButtonSpacing` and the `coop().order`
registration are all *not built* rather than deferred. A panel is also the honest shape for the
question: "is there a full-length of this" is something you want answered while you are looking at
the page, not after a click.

The plan's suggestion of a `coop().order` of **15** is still the right number if buttons ever
arrive, and the gap it sits in is still open.

## 2. Two queries, not the plan's one

`../.plans/scene-variants.md` §4 shows the sibling lookup as a single `findScenes` call. That is
true of the *filter* and false of the *plugin*: the filter needs this scene's stash-ids, and a page
gives you an id in a URL. So it is `findScene` for the ids, then `findScenes` for the siblings, and
the first is what the second's variables come from.

**`endpoint` is deliberately omitted from the criterion.** A sibling set spanning two metadata
providers is still one work, and naming an endpoint would hide half of it. Whether omitting it
matches across endpoints is one of the things §5 lists as unverified.

## 3. The cache is one entry, not a map

`_probe` holds the last scene probed and is replaced when the route changes. A map keyed by scene id
would grow for the life of the tab to serve a hit rate close to zero — you look at a scene page for
minutes and reach the next one by navigating, which is exactly when the entry is replaced. The one
entry is doing the real work: the panel is redrawn on every DOM burst, and without it every burst
would be two queries.

The in-flight guard is `if (_probe !== entry) return`, not a flag: the user can navigate away while
the sibling query is out, and the answer that comes back then belongs to a scene nobody is looking
at.

## 4. Four decisions in the panel that look arbitrary

- **Role outranks running time in the sort.** The panel's usual question is *which of these is the
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
- **The panel is replaced only when its content changes.** `_svrKey` is the scene id plus each
  sibling's id and role, and an existing panel with the same key in the same parent is left alone.
  Rebuilding it on every burst would drop a text selection in it about once a second.

## 5. Unverified — the list a first live session empties

Everything in it is a guess about Stash that no test here can check:

1. **The tab strip anchor.** Ported from `TagBundleClipboard`, which found it live — but that plugin
   puts a *row of buttons* under the strip and this puts a bordered panel, so what is confirmed is
   the anchor, not that a panel looks right there.
2. **The panel's own CSS** against Stash's theme: the greys are the dialogs' greys, but no dialog in
   this repo sits inline on a page the way this does.
3. **That a sibling set is ever found at all** — the query is right by construction now, and nobody
   has seen it return two scenes.

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

## 6. Why there is no dialog, and what that cost in the suite

The plugin draws a panel and links. There is no backdrop, no log, no footer — so
`tests/style.test.js` gained a `chrome: false` flag beside its existing `settings` one, plus the
inverse check that a plugin claiming no dialog defines none of the chrome *and* names no backdrop of
its own in its source. That is the same shape as the settings flag: a flag recording an absence has
to be checked against the plugin, or it is excusing a drift.

The settings half of the shared design is **not** waived. Every plugin here gets a group, a heading
and a description whether or not it puts up a dialog, and the per-setting tooltip applies the moment
there is a setting row. Both halves are byte-identical to the siblings'.

## 7. The three shared mechanisms this plugin correctly does not use

No lease (it issues no mutation), no `respecters` entry (it reacts to no save), no `declares` entry
(it copies no relationship, so any path id would be a lie). `TagBundleClipboard` is the precedent for
all three. A fourth is added here: no `coop().order`, because the ordering protocol is about buttons
sharing one of Stash's own action rows and this panel has its own container with nobody in it.

What it *does* read is `coop().debugButtons`, on the same reasoning the name already stretched to
cover a list-view menu item: the flag answers "why is this control not there", and a panel is a
control.

## 8. Where L1 goes when it arrives

The title and shared-performer fallbacks are the plan's §5 L1, and the seam for them is `probe`'s
`if (!ids.length)` branch — today it returns an empty set with a reason string, and the reason
string is already what the panel head prints. A title-matched sibling has to be *marked* as such in
the row, since the confidence differs from an id match; the `cls` object each row carries is where
that goes.

With about two scenes in three carrying no stash-id in the user's library, L1 is worth more than
everything above it in the plan.
