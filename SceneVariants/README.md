# ᝯㄝₓ Scene Variants

A scene is often in your library twice: the whole thing, and a cut out of it. Stash has no way to
say the two are the same work — [the request to link scenes to each other](https://github.com/stashapp/stash/issues/3201)
was closed with "Groups cover scene to scene linking", and a Group is a heavy object to mint for
"these two files are the same scene". So this plugin derives the relation instead of storing it.

Open a scene. Beside **Details**, **File Info** and **Edit** there is now a **Siblings** tab:

```
Details   Queue   Markers   Filter   File Info   History   Siblings   Edit
──────────────────────────────────────────────────────────┴────────────────
2 other scenes are the same work. Matched on 1 stash-id.
  Cool Shoot                        Full Length     1920×1080 · 41:12
  Cool Shoot - Clip 2               Partial Length  1920×1080 · 4:03
```

Each title is a link. Nothing is written to your library at any point — the tab is one query and a
list of links.

The tab is always there, including on the scenes that have no siblings to show, and it says which of
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
Leave both empty and the tab still lists the siblings — it just says nothing about which is which.

Rows are ordered full-length first, then longest running time, because "which of these is the whole
thing" is the question the tab exists to answer. A scene carrying **both** tags is shown in red:
the two are mutually exclusive by definition, so the contradiction is reported rather than resolved.

## What it does not do

**The stash-id is the only evidence used.** A scene that never got one, or whose siblings never got
one, gets a tab that says so and lists nothing. Matching on a title convention (`<title> - Clip 2`)
and on shared performers is the obvious next step and is not built — expect a list on the scenes
that carry the id convention and nowhere else.

**It never writes.** No tag is added, no title is corrected, no stash-id is propagated. Everything
the tab notices that looks wrong is shown and left alone.

**Scene pages only.** There is nothing on a performer, studio or group.

**No count on the tab caption.** The strip and the pane are two separate extension points rendering
two separate components, so a count beside the word would mean sharing the query's answer between
them to save you one click. The pane counts its own rows in its first line instead.

## Installing

Copy the `SceneVariants` folder into your Stash plugins directory, then **Settings → Plugins →
Reload plugins**. There is no build step and nothing to install.

**Requires Stash 0.28.0 or newer.** The tab is added through the scene page's own plugin extension
points (`ScenePage.Tabs` and `ScenePage.TabContent`), which arrived in that release. On anything
older there is no tab at all and one line in the browser console saying why — there is deliberately
no hand-built imitation of a tab to fall back to.

## Troubleshooting

**No Siblings tab at all.** Either Stash is not 0.28.0 or newer, or the browser is running a cached
copy of an older script — the settings page shows a stale-script banner when it can tell.
`Ctrl+Shift+R` (`⌘+Shift+R` on a Mac) reloads it. The console says which, once, at load.

**The tab is empty on a scene you know has siblings.** The tab tells you why in its first line.
Check the scene has a stash-id at all (**Edit → Stash IDs**), and that its siblings carry the same
one. A failed query is always reported to the console, whatever the settings say.

**Every row is unclassified.** The two tag names in the settings do not match the tags on those
scenes. Copy the tag name from the tag's own page rather than retyping it.

**The tab appeared and then stopped after a Stash upgrade.** The extension points it hangs off are
Stash's and can move. That is the first thing to suspect, and the console line at load is where it
will show.
