#!/usr/bin/env bash
# Stop hook: copy what only exists inside this sandbox onto the host.
#
# Three storage layers live in this container and only one reaches the host disk:
# the repo working tree, mounted over virtiofs. `~/.claude/projects/<slug>/*.jsonl`
# - the complete record of every conversation in this project, back to the day it
# started - is on a sandbox volume, which survives a restart but not `sbx rm`, and
# nothing in git holds it either. So the copy goes into a git-ignored directory
# inside the mount.
#
# Stop, not SessionEnd. SessionEnd needs the session to end cleanly, and a closed
# terminal or a removed sandbox never gets there - which is the case a backup is
# for. Stop fires after every turn and rsync copies only the file that changed:
# 86 ms per turn against 114 MB of transcript, so the host copy is never more than
# one turn behind.
#
# No --delete, deliberately: this is a backup, not a mirror. Anything removed from
# the sandbox stays in the backup.
#
# Never blocks. It prints nothing and always exits 0 - a failed copy must not stop
# the session, and a hook that reports on every turn is a hook that gets switched
# off.

set -u

PROJ="${CLAUDE_PROJECT_DIR:-/d/AI_Projects/StashPlugins}"
DEST="$PROJ/.plans/sandbox-backup"
SRC="$HOME/.claude"
# Claude Code names a project directory by replacing every "/" with "-", so the
# slug is derived rather than written down - this hook is tracked in git and must
# not carry one machine's paths.
SLUG="$(printf %s "$PROJ" | sed 's|/|-|g')"

mkdir -p "$DEST/transcripts" "$DEST/claude-config" 2>/dev/null || { echo '{}'; exit 0; }

# The conversations themselves.
[ -d "$SRC/projects/$SLUG" ] &&
  rsync -a -m --include='*/' --include='*.jsonl' --exclude='*' \
    "$SRC/projects/$SLUG/" "$DEST/transcripts/" 2>/dev/null

# Small, hand-made, and annoying to reconstruct: the global settings (model,
# plugins, marketplaces), the prompt history, and the plan/todo/task state.
# Deliberately not `file-history` (76 MB of edit history for files git already
# holds) or `plugins` (14 MB, reinstallable from its marketplace).
for f in settings.json history.jsonl; do
  [ -f "$SRC/$f" ] && cp -p "$SRC/$f" "$DEST/claude-config/$f" 2>/dev/null
done
for d in plans todos tasks backups; do
  [ -d "$SRC/$d" ] && rsync -a "$SRC/$d/" "$DEST/claude-config/$d/" 2>/dev/null
done

# The instructions file for *every* project in this sandbox sits one directory
# above the repo - which is the overlay, not the mount, so `sbx rm` takes it. It
# is the document most likely to look permanent and not be.
[ -f "$(dirname "$PROJ")/CLAUDE.md" ] &&
  cp -p "$(dirname "$PROJ")/CLAUDE.md" "$DEST/parent-CLAUDE.md" 2>/dev/null

echo '{}'
exit 0
