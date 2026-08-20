# ᝯㄝₓ Scene Variants

A scene is often in your library twice: the whole thing, and a cut out of it. Stash has no way to
say the two are the same work — [the request to link scenes to each other](https://github.com/stashapp/stash/issues/3201)
was closed with "Groups cover scene to scene linking", and a Group is a heavy object to mint for
"these two files are the same scene". So this plugin derives the relation instead of storing it.

Open a scene. Beside **Details**, **File Info** and **Edit** there is now a **Variants** tab:

```
Details   Queue   Markers   Filter   File Info   History   Variants   Edit
──────────────────────────────────────────────────────────┴────────────────
2 other variants of this scene. Matched on 1 stash-id.
  ┌────────┐  Cool Shoot
  │ cover  │  Full-length · 1920×1080 · 41:12
  └────────┘
  ┌────────┐  Cool Shoot - Clip 2
  │ cover  │  Partial-length · 1920×1080 · 4:03
  └────────┘
```

The tab sits just before **Edit**, which stays last, and is amber — the one tab in that strip Stash
did not put there.

Each cover and title is a link, and a cover plays the scene's preview loop while the pointer is over
it — the same preview the scene cards use. Nothing is written to your library at any point: the tab
is one query and a list of links.

Rows say **Full-length** and **Partial-length** rather than echoing your tag names back. The tag
that decided a row is on its hover text, which is where it is useful and where it is not in the way
of reading the column.

The tab is always there, including on the scenes that have no variants to show, and it says which of
the reasons applies. That is deliberate: a tab that came and went as a query landed would move the
strip under your pointer, and "this scene carries no stash-id" is the most useful thing it has to
say on most scenes today.

## What it needs from you

Two settings, both optional, both under **Settings → Plugins → ᝯㄝₓ Scene Variants**:

| Setting | What it does |
|---|---|
| Full-length Tag | The name of the tag you put on a scene that is the whole work |
| Partial-length Tag | The name of the tag you put on a cut of one |

Names are typed rather than picked, and compared without regard to case or surrounding spaces.
Leave both empty and the tab still lists the variants — it just says nothing about which is which.

Rows are ordered full-length first, then longest running time, because "which of these is the whole
thing" is the question the tab exists to answer. The value starts the line under each title, so a
short list reads as a column: full-length is green and partial-length amber; a scene with neither tag simply has no label. A scene carrying
**both** is shown in red — the two are mutually exclusive by definition, so the contradiction is
reported rather than resolved.

## What it does not do

**The stash-id is the only evidence used.** A scene that never got one, or whose variants never got
one, gets a tab that says so and lists nothing. Matching on a title convention (`<title> - Clip 2`)
and on shared performers is the obvious next step and is not built — expect a list on the scenes
that carry the id convention and nowhere else.

**It never writes.** No tag is added, no title is corrected, no stash-id is propagated. Everything
the tab notices that looks wrong is shown and left alone.

**Scene pages only.** There is nothing on a performer, studio or group.

**One dimension, and it is built in.** Full-length versus partial-length is the only distinction the
plugin knows; the two tag names are the only part of it you can configure. A settings-driven table of
dimensions — resolution, cut, release — is a later level, and deliberately not guessed at now.

**No count on the tab caption.** The strip and the pane are two separate extension points rendering
two separate components, so a count beside the word would mean sharing the query's answer between
them to save you one click. The pane counts its own rows in its first line instead.

**No scrubber on the covers**, and no rating, organised flag or O-counter. Stash's own `SceneCard`
has all of that and the plugin API offers it — but it wants a forty-odd-field scene fragment to
render, hand-copied into a query here and silently wrong the day the card reads one more field. Two
path fields buy the cover and the preview, which is what was asked for.

## Installing

Copy the `SceneVariants` folder into your Stash plugins directory, then **Settings → Plugins →
Reload plugins**. There is no build step and nothing to install.

**Requires Stash 0.28.0 or newer.** The tab is added through the scene page's own plugin extension
points (`ScenePage.Tabs` and `ScenePage.TabContent`), which arrived in that release. On anything
older there is no tab at all and one line in the browser console saying why — there is deliberately
no hand-built imitation of a tab to fall back to.

## Troubleshooting

**No Variants tab at all.** Either Stash is not 0.28.0 or newer, or the browser is running an older
copy of the script. The console says which, once, at load, and the settings page shows a
stale-script banner when it can tell.

**To find out which script Stash is actually serving**, open `/plugin/SceneVariants/javascript` on
your Stash and search it for `PLUGIN_VERSION`. Those are the exact bytes your browser is given.
Stash sends that with `Cache-Control: no-cache` and an ETag, so **the browser cannot be serving you a
stale copy** — if the version there is old, the file in your plugins directory is old, and the copy
never landed. Check for a second `SceneVariants` folder there under a different name too: Stash keys
on the `id:` in the manifest, so a duplicate shadows the one you are updating.

A JS change needs **no plugin reload** — Stash reads the file on every request, so overwriting it
and reloading the page is enough. Reload plugins only when the `.yml` changes.

**The tab is empty on a scene you know has variants.** The tab tells you why in its first line.
Check the scene has a stash-id at all (**Edit → Stash IDs**), and that its variants carry the same
one. A failed query is always reported to the console, whatever the settings say.

**Every row is unclassified.** The two tag names in the settings do not match the tags on those
scenes. Copy the tag name from the tag's own page rather than retyping it.

**The tab appeared and then stopped after a Stash upgrade.** The extension points it hangs off are
Stash's and can move. That is the first thing to suspect, and the console line at load is where it
will show.
