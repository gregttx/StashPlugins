# Stop hooks

Four checks and one backup, run by Claude Code after every turn. They are project policy rather
than personal settings, which is why they are tracked while `.claude/settings.local.json` — model,
theme, permission mode — is not.

| Hook | What it does |
| --- | --- |
| `docs-freshness.sh` | **The strict half.** A plugin's own `README.md` or `CLAUDE.md` left behind by a change to that plugin's own source; a commit that changed a script without moving its version; a release in git history missing from the generated `RELEASES.md`. Every finding compares two files in one folder, or a number - so it blocks, and it is meant to be answered rather than muted. |
| `docs-crosslinks.sh` | **The loose half.** Documents no single folder owns: `tests/README.md` against the suites, the working plan against any plugin's source, and drift between two plugins' docs - one plugin changing a shared mechanism that four other documents describe. Guesses by construction. Mute a finding with `echo '<substring>' >> .claude/hooks/docs-crosslinks.mute`, or everything with `ALL`; that file is git-ignored. |
| `common.sh` | Sourced by both of the above, not a hook. The working tree, the last commit, and the reflog guard that decides whether HEAD moved because of a commit authored here. One copy so the two hooks cannot answer different questions about what "the change just made" means. |
| `first-release-version.sh` | A new plugin's first release is `0.0.1`. The major digit is the claim that it has been used in a live Stash, and no test here can make that claim. |
| `backup-transcripts.sh` | Copies this sandbox's conversation logs and Claude's small config onto the host, into `.plans/sandbox-backup/`. See the comment at the top for why it runs on `Stop` rather than `SessionEnd`. |

## Wiring

`settings.local.json` is not tracked, so a fresh clone has the hooks and nothing calling them. Add:

```jsonc
"hooks": { "Stop": [ { "hooks": [
  { "type": "command", "timeout": 10,
    "command": "rsync -a --delete --exclude=README.md ~/.claude/projects/<slug>/memory/ \"$CLAUDE_PROJECT_DIR/.plans/memory/\" 2>/dev/null || true" },
  { "type": "command", "timeout": 60, "command": "\"$CLAUDE_PROJECT_DIR/.claude/hooks/backup-transcripts.sh\"" },
  { "type": "command", "timeout": 15, "command": "\"$CLAUDE_PROJECT_DIR/.claude/hooks/docs-freshness.sh\"" },
  { "type": "command", "timeout": 15, "command": "\"$CLAUDE_PROJECT_DIR/.claude/hooks/docs-crosslinks.sh\"" },
  { "type": "command", "timeout": 15, "command": "\"$CLAUDE_PROJECT_DIR/.claude/hooks/first-release-version.sh\"" }
] } ] }
```

## The executable bit has to be set in the index, not on disk

This tree is a virtiofs mount from a Windows host, so `core.filemode` is `false` and git records
none of the modes it sees. A new hook added here therefore lands as `100644` and is silently inert
after a clone — the hook simply never runs, with nothing reporting why. Set it explicitly:

```bash
git update-index --chmod=+x .claude/hooks/<new-hook>.sh
git ls-files -s .claude/hooks    # every line should read 100755
```

## Why the docs check is two hooks

They were one, and the strict rules paid for the loose ones. A single misfire -
`tools/probe.js` matching a pattern that meant "a plugin's source" - is enough to
teach a reader to skim, and the rules worth reading are the ones that are very
nearly facts. Split by confidence, `docs-freshness.sh` can stay strict and
`docs-crosslinks.sh` is allowed to guess, because muting it costs one line.

`common.sh` is sourced rather than duplicated because the two must agree on what
"the change just made" means. `first-release-version.sh` still carries its own
copy: it is a working guard rail with a different job, and rewiring it was not
asked for. A fourth hook needing this is the moment to fold it in.
