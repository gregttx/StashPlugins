#!/usr/bin/env bash
# Stop hook: a document left behind by a change to the code it describes.
#
# THIS HOOK IS THE STRICT HALF. Everything here is folder-local or mechanical:
# a plugin's own docs against that plugin's own source, a version that did not
# move, a release row that cannot exist yet. Each finding is about two files in
# one directory, or about a number, so a false positive means something really
# is inconsistent. It blocks, and it is meant to be answered rather than muted.
#
# The cross-cutting rules - `tests/README.md`, the working plan, and drift
# between two plugins' docs - moved to `docs-crosslinks.sh`. They span folders,
# they guess, and mixing them in here cost this hook its credibility: a reader
# who has seen it misfire once starts skimming the findings that are certain.
# Splitting by confidence is what lets this one stay strict.
#
# The signal is git, not mtime. An earlier version compared mtimes and
# immediately reported a plugin nobody had touched in weeks: git does not
# preserve mtimes, so checkout order alone decides which file looks newer. No
# mtime is read anywhere in this script or its siblings.
#
# Two rules, both meaning "source moved without its docs":
#   A. working tree — a plugin's source is dirty while its docs are not
#   B. HEAD         — the last commit touched a plugin's source, and its docs
#                     are neither in that commit nor edited since, and that
#                     commit was actually authored here (see common.sh)

. "$(dirname "${BASH_SOURCE[0]}")/common.sh"

STATE_DIR="${TMPDIR:-/tmp}/claude-docs-freshness"
stale=()

# --- Rule 1: a plugin's own README.md / CLAUDE.md against its own source -----
while IFS= read -r d; do
  [ -n "$d" ] || continue
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
done <<EOF
$(plugin_dirs)
EOF

# --- Rule 2: a commit that changed a script without moving its version -------
# The one case the stale-script banner is structurally blind to: both numbers
# stay equal, so every tab goes on reporting the version it is not running.
#
# The working tree half is deliberately absent. A version bump is the *last*
# edit of a change, so flagging a dirty script with an unbumped version would
# fire through the whole of every session. The commit is the point at which it
# is too late.
#
# The version itself is compared, not merely whether the manifest was in the
# commit: a commit that edits a description touches the manifest and moves no
# version, and reading that as a bump is the whole failure being guarded against.
manifest_version() { git show "$1:$2/manifest" 2>/dev/null | sed -n 's/^version: *//p'; }
while IFS= read -r d; do
  [ -n "$d" ] || continue
  in_list "$d/$d.js" "$head_files" || continue
  now=$(manifest_version HEAD "$d")
  prev=$(manifest_version HEAD~1 "$d")
  [ -n "$now" ] && [ "$now" = "$prev" ] &&
    stale+=("$d — the last commit changed $d.js and left the version at $now")
done <<EOF
$(plugin_dirs)
EOF

# --- Rule 3: a release in git history missing from the generated notes -------
# `RELEASES.md` is generated from git history, so a release row names the commit
# that bumped the version and cannot be written by that commit - adding the row
# would change the sha the row points at. This rule is what asks for the
# follow-up commit.
#
# HEAD only, for the same reason as rule 2: a dirty manifest is a bump in
# progress and there is nothing to generate from it yet.
#
# It compares *releases*, not bytes, so pushing - which turns a short id into a
# link - is not something it reports.
if printf '%s\n' "$head_files" | grep -qE '^[A-Za-z0-9]+/(manifest|[A-Za-z0-9]+\.yml)$' &&
   command -v node >/dev/null 2>&1 && [ -f tools/gen-releases.js ]; then
  while IFS= read -r f; do
    [ -n "$f" ] && stale+=("$f — a release in git history is missing from it; run \`node tools/gen-releases.js\`")
  done <<EOF
$(node tools/gen-releases.js --check 2>/dev/null)
EOF
fi

[ ${#stale[@]} -eq 0 ] && { echo '{}'; exit 0; }

list=$(printf '  - %s\n' "${stale[@]}")
summary="Docs may be stale: ${#stale[@]} file(s) behind the code they describe."

emit "$STATE_DIR" "$summary" "Before finishing: these documents look left behind by the change just made.

$list
Update what is genuinely out of date — status and version lines, the step table,
and any passage the change now contradicts. If the code changed, bump the version
in all three places (.yml, manifest and its date:, PLUGIN_VERSION) unless already
done.

This is a heuristic, not a verdict. If a document is in fact still accurate, say
so in one line and stop — it will not ask again for the same finding." "$list"
