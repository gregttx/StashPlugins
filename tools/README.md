# tools/

Repo tooling. Neither file ships in any plugin's `files:`, so changing one is not
a release and needs no version bump.

- `gen-releases.js` — builds `RELEASES.md` and the five per-plugin release files
  from git history. `node tools/gen-releases.js`.
- `probe.js` — reports what a live Stash actually renders. Read on.
- `enm-probe.js` — reports what a live Stash actually *posts* when you rename
  something, and who was listening. Read on.

## enm-probe.js

`probe.js` answers "what does the page look like". This one answers a question
`ᝯㄝₓ Entity Name Maintainer` cannot answer about itself: **does it ever see the
request Stash posts when you rename something?**

A plugin's own diagnostic is written by the code that may not be running — a
stale script, a latched wrapper, a handler another evaluation owns. This probe is
independent of it, and works whether the plugin is installed, disabled, or three
releases behind.

### Running it

1. Open Stash. DevTools → Console. Paste the entire contents of `enm-probe.js`.
2. **Rename the thing that does not open the dialog.**
3. Run `__enmProbe.report()`. It prints and copies itself to the clipboard.

```bash
cat tools/enm-probe.js      # then copy
```

`__enmProbe.stop()` removes the listeners; a page reload removes them anyway. It
sends no request of its own and writes nothing.

### What it settles, and in what order

| Line | What a bad value means |
|---|---|
| `the fetch the probe wrapped was native: true` | no plugin wrapper was installed under the probe — the hook is not there at all |
| `requests seen through fetch: 0` | Stash is not using `window.fetch` for GraphQL, and **no** plugin here can see its traffic |
| `requests seen through XMLHttpRequest: <n>` with fetch at 0 | it is on the other transport, which nothing in this repo hooks |
| `requests that named one of the seven update mutations: 0` | the save is not one of the seven — the query text below says what it is |
| `variables.input present: false` | the client inlines the entity in the query text instead of passing variables |
| `in the selection set: false` | the mutation is named somewhere other than where `renameOf` looks for it |
| `enmFetchWrap: true` with the plugin's own `requests seen: 0` | the plugin's wrapper is installed but out of the chain |

It has already earned its keep once. Three rounds of reading the diff had found nothing;
one paste of this produced `the response was not JSON`, which named the failing step
exactly and led to the rule now in the root `CLAUDE.md` about not reading a shared
response body.

It records **field names and string lengths, never values** — no title, no name,
no description — so the report can be pasted into an issue as it stands.

## probe.js

The suites in `tests/` check the plugins' own logic. They cannot check the
plugins' *assumptions about Stash* — its markup, its computed styles, its
schema — because those live in someone else's codebase and change without us.
Every expensive bug in this repo's history sits in that gap:

| Cost | The fact that would have settled it |
|---|---|
| four versions of anchor churn | `button.delete` matches nothing on a Scene edit row |
| `row-gap` inert on three of four pages | `.edit-buttons` computes to `display: block` |
| gaps doubled on Group | the element beside a button is a wrapper, or an empty slot |
| task buttons lost in four plugins | the `h3` no longer reads what `ownTaskName` expects |
| a renormalizer broken for four releases | a STRING setting's id lands on the row div, not an input |

One paste answers all five. **Paste the output back into the session rather than
describing it** — that is the whole point of the tool.

### Running it

1. Open the Stash page whose shape you care about.
2. DevTools → Console. Paste the entire contents of `probe.js`. Enter.
3. The report prints and copies itself to the clipboard. Paste it into Claude Code.

```bash
cat tools/probe.js          # then copy
```

Run it once **per page shape**, not once per session — it reports what is on
screen now. The five worth having, and what each one settles:

| Page | Answers |
|---|---|
| a Scene | `.edit-buttons`, the Delete/Save anchors, row layout and margins |
| a Performer | `.details-edit` in both places, the `.delete` navbar class |
| a Group | the wrapper and empty-slot cases that doubled the gap |
| a list view | `.grid-card`, `#more-menu`, `.dropdown-menu` |
| Settings → Plugins | every `plugin-<id>-<key>` id and what element it landed on, and each of our own groups' header buttons (the Enable/Disable the superseded notice inserts before) |

Settings → **Tasks** is worth a look by eye at the same time. It is the half of a
rename most likely to break while the settings page still looks right.

### What it reports, and what it refuses to

**Facts, never conclusions.** It prints "`button.delete` matches 0 nodes, the row
contains Save then Delete" — never "the anchor should be Save". Deciding that is
`insertBeforeImportantAction`'s job, in five plugins. A probe that re-implemented
the rule would be a sixth copy free to drift, and a drifted probe is worse than
no probe: it is wrong with authority. Whoever reads the output applies the rule.

Sections: containers by selector and count · each button row's layout and every
child's margins, `_coopOwner` and wrapped `.btn` · every action by label and
class · `plugin-<id>-<key>` ids and the element each lands on · our own setting
groups' header actions · `h3` headings as
Stash renders them, version suffix included · the themed colours of five button
variants · the whole `__GTTx__` object (leases, respecters, order, declares, api,
domBus) · a GraphQL introspection of the custom-fields table in the root
`CLAUDE.md`, which is a snapshot and this is not.

**Read-only.** No mutation, no `configurePlugin`, no write of any kind. The only
network call is an introspection query. Safe on a real library.

**The DOM half always prints**, even where the schema half fails — it is wrapped
for exactly that reason. A probe that returns nothing because one section threw
is a probe nobody runs twice.

### Keeping it honest

Its selector list mirrors what the plugins actually reach for. When a plugin
starts depending on a new selector, class or computed property, add it here in
the same change — an assumption the probe does not report is an assumption back
in the gap this tool exists to close.
