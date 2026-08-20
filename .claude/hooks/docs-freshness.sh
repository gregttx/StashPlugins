#!/usr/bin/env bash
# Stop hook: flag documents left behind by a change to the code they describe.
#
# The signal is git, not mtime. An earlier version of this script compared
# mtimes and immediately reported a plugin nobody had touched in weeks: git
# does not preserve mtimes, so checkout order alone decides which file looks
# newer. Only the working tree and the commit graph know what actually changed.
#
# Two rules, both meaning "source moved without its docs":
#   A. working tree — a plugin's source is dirty while its docs are not
#   B. HEAD         — the last commit touched a plugin's source, and its docs
#                     are neither in that commit nor edited since, and that
#                     commit was actually authored here (see the reflog guard
#                     below — HEAD also moves for reset, checkout and rebase,
#                     which say nothing about whether docs are current)
#
# Every document is checked the same way, the working plan included. It was once
# checked by mtime, while it was still git-ignored and had no history to consult;
# that rule was wrong twice and is gone. No mtime is read anywhere in this script.
#
# Blocks the stop ONCE per distinct finding per session. A document that
# genuinely needed no change must not nag forever, so the sentinel is keyed on
# the finding itself: address it, or decide it is already accurate, and the
# next stop is quiet.

set -u

# Derived from the script's own location (.claude/hooks/), not hardcoded, so a
# clone elsewhere works and the hook cannot silently check the wrong tree.
REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." 2>/dev/null && pwd)
# The plugin was renamed from *migrate* to *propagate* and this path was not, so the
# `[ -f "$PLAN" ]` guard below silently retired the whole plan-freshness rule for as long
# as it took someone to read the file. A path that names a file is a path that has to be
# checked against the tree - so it is derived, and a plan that goes missing is reported
# rather than skipped.
PLAN=.plans/propagate-tags-and-performers.md
STATE_DIR="${TMPDIR:-/tmp}/claude-docs-freshness"

cd "$REPO" 2>/dev/null || { echo '{}'; exit 0; }
git rev-parse --git-dir >/dev/null 2>&1 || { echo '{}'; exit 0; }

payload=$(cat 2>/dev/null || true)
session=$(printf '%s' "$payload" | jq -r '.session_id // "nosession"' 2>/dev/null || echo nosession)

dirty=$(git status --porcelain 2>/dev/null | awk '{ $1=""; sub(/^ +/,""); print }')
head_files=$(git diff-tree --no-commit-id --name-only -r HEAD 2>/dev/null)

# Rule B says "the last commit changed X" — but it reads HEAD, and HEAD moves for
# reasons that are not a commit. Rewinding a branch, switching to another one or
# rebasing all park HEAD on some older commit, and rule B then reports that
# commit's docs as "left behind by the change just made" when the change was made
# days ago and was complete at the time. That is what it did after a `git reset`
# archived a branch: it named a plugin whose last real edit predated the session.
#
# The reflog says which it was. Its top entry for HEAD is `commit: ...` when a
# commit was just created here, and `reset:` / `checkout:` / `rebase ...` when
# HEAD merely moved. Only the former means "the change just made".
#
# Dropping `head_files` retires rule B everywhere at once — plugin docs, the test
# index and the plan all consult it — while rule A (a dirty working tree) still
# applies, since that is a statement about the tree in front of us and stays true
# however HEAD got where it is.
#
# Cherry-pick, merge and rebase do introduce commits, and are deliberately not
# treated as authoring: they replay work that was already reviewed where it was
# written. If the reflog is unavailable at all, rule B is left on rather than
# silently disabling half the check — a missing reflog is not the failure here.
reflog_top=$(git reflog --format='%gs' -1 2>/dev/null || true)
if [ -n "$reflog_top" ]; then
  case "$reflog_top" in
    commit:*|'commit (amend):'*|'commit (initial):'*|'commit (merge):'*) ;;
    *) head_files='' ;;
  esac
fi

in_list() { printf '%s\n' "$2" | grep -qxF "$1"; }

stale=()

for js in */*.js; do
  d=${js%/*}
  [ "$d/$d.js" = "$js" ] || continue          # only <Dir>/<Dir>.js is a plugin

  src_dirty=0 src_head=0
  for s in "$d/$d.js" "$d/$d.yml" "$d/manifest"; do
    in_list "$s" "$dirty"      && src_dirty=1
    in_list "$s" "$head_files" && src_head=1
  done
  [ "$src_dirty" -eq 1 ] || [ "$src_head" -eq 1 ] || continue

  for doc in README.md CLAUDE.md; do
    [ -f "$d/$doc" ] || continue
    in_list "$d/$doc" "$dirty" && continue                       # already being edited
    if [ "$src_dirty" -eq 1 ]; then
      stale+=("$d/$doc — $d has uncommitted source changes")
    elif ! in_list "$d/$doc" "$head_files"; then
      stale+=("$d/$doc — left out of the last commit, which changed $d's source")
    fi
  done
done

# A commit that changes a plugin's script without moving its version is the one case the
# stale-script banner is structurally blind to: both numbers stay equal, so every tab goes
# on reporting the version it is not running. Rule B's machinery already answers exactly
# this shape of question, and the reflog guard above already decides when HEAD is a commit
# authored here.
#
# The working tree half is deliberately absent. A version bump is the *last* edit of a
# change, so flagging a dirty script with an unbumped version would fire through the whole
# of every session. The commit is the point at which it is too late.
#
# The version itself is compared, not merely whether the manifest was in the commit: a
# commit that edits a description touches the manifest and moves no version, and reading
# that as a bump is the whole failure being guarded against.
manifest_version() { git show "$1:$2/manifest" 2>/dev/null | sed -n 's/^version: *//p'; }
for js in */*.js; do
  d=${js%/*}
  [ "$d/$d.js" = "$js" ] || continue
  in_list "$d/$d.js" "$head_files" || continue
  now=$(manifest_version HEAD "$d")
  prev=$(manifest_version HEAD~1 "$d")
  [ -n "$now" ] && [ "$now" = "$prev" ] &&
    stale+=("$d — the last commit changed $d.js and left the version at $now")
done

# tests/README.md indexes the suites.
if [ -f tests/README.md ] && ! in_list tests/README.md "$dirty"; then
  suites_dirty=$(printf '%s\n' "$dirty" | grep -c '^tests/.*\.js$' || true)
  suites_head=$(printf '%s\n' "$head_files" | grep -c '^tests/.*\.js$' || true)
  if [ "$suites_dirty" -gt 0 ]; then
    stale+=("tests/README.md — test suites have uncommitted changes")
  elif [ "$suites_head" -gt 0 ] && ! in_list tests/README.md "$head_files"; then
    stale+=("tests/README.md — left out of the last commit, which changed the suites")
  fi
fi

# The working plan, now that it is tracked and has history of its own.
#
# It was checked by mtime while it was git-ignored, and that rule was wrong twice: once
# against the last commit's timestamp, which `git commit --amend` moves forward past a
# document written correctly minutes earlier, and once against file mtimes, which a
# checkout or merge rewrites wholesale. Both produced a confident report about a file
# that was perfectly current. It now follows exactly the same git rule as every other
# document here, and no mtime is consulted anywhere in this script.
if [ -f "$PLAN" ] && ! in_list "$PLAN" "$dirty"; then
  src_dirty_any=0 src_head_any=0
  printf '%s\n' "$dirty"      | grep -qE '^[A-Za-z0-9]+/[A-Za-z0-9]+\.(js|yml)$' && src_dirty_any=1
  printf '%s\n' "$head_files" | grep -qE '^[A-Za-z0-9]+/[A-Za-z0-9]+\.(js|yml)$' && src_head_any=1
  if [ "$src_dirty_any" -eq 1 ]; then
    stale+=("$PLAN — plugin source has uncommitted changes")
  elif [ "$src_head_any" -eq 1 ] && ! in_list "$PLAN" "$head_files"; then
    stale+=("$PLAN — left out of the last commit, which changed plugin source")
  fi
fi

[ ${#stale[@]} -eq 0 ] && { echo '{}'; exit 0; }

list=$(printf '  - %s\n' "${stale[@]}")
key=$(printf '%s' "$list" | md5sum 2>/dev/null | cut -c1-32)
sentinel="$STATE_DIR/$session-$key"

summary="Docs may be stale: ${#stale[@]} file(s) behind the code they describe."

if [ -f "$sentinel" ]; then
  jq -n --arg m "$summary (already flagged)" '{systemMessage: $m}'
  exit 0
fi

mkdir -p "$STATE_DIR" 2>/dev/null && : > "$sentinel"

reason="Before finishing: these documents look left behind by the change just made.

$list
Update what is genuinely out of date — status and version lines, the step table,
and any passage the change now contradicts. If the code changed, bump the version
in all three places (.yml, manifest and its date:, PLUGIN_VERSION) unless already
done.

This is a heuristic, not a verdict. If a document is in fact still accurate, say
so in one line and stop — it will not ask again for the same finding."

jq -n --arg r "$reason" --arg m "$summary" \
  '{decision: "block", reason: $r, systemMessage: $m}'
