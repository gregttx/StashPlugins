# ᝯㄝₓ Scene Variants

A scene is often in your library twice: the whole thing, and a cut out of it. Stash has no way to
say the two are the same work — [the request to link scenes to each other](https://github.com/stashapp/stash/issues/3201)
was closed with "Groups cover scene to scene linking", and a Group is a heavy object to mint for
"these two files are the same scene". So this plugin derives the relation instead of storing it.

Open a scene. If other scenes share its stash-id, a **Siblings** panel appears under the tabs:

```
2 other scenes are the same work — matched on 1 stash-id
  Cool Shoot                        Full Length     1920×1080 · 41:12
  Cool Shoot - Clip 2               Partial Length  1920×1080 · 4:03
```

Each title is a link. Nothing is written to your library at any point — the panel is two queries and
a list of links.

## What it needs from you

Two settings, both optional, both under **Settings → Plugins → ᝯㄝₓ Scene Variants**:

| Setting | What it does |
|---|---|
| Full-length Tag | The name of the tag you put on a scene that is the whole work |
| Partial-length Tag | The name of the tag you put on a cut of one |

Names are typed rather than picked, and compared without regard to case or surrounding spaces.
Leave both empty and the panel still lists the siblings — it just says nothing about which is which.

Rows are ordered full-length first, then longest running time, because "which of these is the whole
thing" is the question the panel exists to answer. A scene carrying **both** tags is shown in red:
the two are mutually exclusive by definition, so the contradiction is reported rather than resolved.

## What it does not do

**The stash-id is the only evidence used.** A scene that never got one, or whose siblings never got
one, shows no panel at all. Matching on a title convention (`<title> - Clip 2`) and on shared
performers is the obvious next step and is not built — expect the panel on the scenes that carry the
id convention and nowhere else.

**It never writes.** No tag is added, no title is corrected, no stash-id is propagated. Everything
the panel notices that looks wrong is shown and left alone.

**Scene pages only.** The panel hangs off the scene page's tab strip; there is nothing on a
performer, studio or group.

## Installing

Copy the `SceneVariants` folder into your Stash plugins directory, then **Settings → Plugins →
Reload plugins**. There is no build step and nothing to install.

## Troubleshooting

**No panel on a scene you know has siblings.** Check the scene has a stash-id at all
(**Edit → Stash IDs**), and that its siblings carry the same one. Then open the browser console: a
failed sibling query is always reported there, whatever the settings say.

**The panel is there but every row is unclassified.** The two tag names in the settings do not match
the tags on those scenes. Copy the tag name from the tag's own page rather than retyping it.

**Nothing at all, and no console line.** The browser is probably running a cached copy of an older
script — the settings page shows a stale-script banner when it can tell. `Ctrl+Shift+R`
(`⌘+Shift+R` on a Mac) reloads it.

**Everything the panel shows is a guess about Stash's markup**, so a Stash upgrade can move the tab
strip out from under it. If the panel disappears after one, that is the first thing to suspect.
