#!/usr/bin/env bash
# Stop hook: refuse a first release that claims 1.0.0 or higher.
#
# WHY THIS EXISTS, since a hook that nobody remembers the reason for gets
# deleted: the repo's rule is that a new plugin starts at 0.0.1 and the major
# digit is a claim to the user that the thing works. That rule is in the memory
# index, in the repo-root CLAUDE.md and in every plugin's own CLAUDE.md, and it
# has still been broken twice — both times by reasoning that "this one is
# feature-complete, so the major digit is earned". Complete is not verified.
# Advisory documentation can be argued past; a Stop hook cannot.
#
# THE SIGNAL IS GIT, not a version string on its own. `git log -- <folder>`
# empty means the folder has never been committed, which is the only mechanical
# definition of "first release" available: a plugin whose 1.0.0 was reviewed and
# committed at some point is not this bug and must not be nagged about forever.
# Same reasoning as docs-freshness.sh next door — the working tree and the commit
# graph know things no file content does.
#
# What it deliberately does NOT do: judge whether a plugin is ready. Nothing here
# can. It only catches the one case that needs no judgement — a folder with no
# history declaring a major of 1 or more.
#
# Blocks ONCE per distinct finding per session, keyed on the finding, so a
# deliberate decision to ship a first release at 1.0.0 (say, a plugin developed
# elsewhere and moved in) is stated once and then left alone.

set -u

# Derived from the script's own location (.claude/hooks/), not hardcoded, so a
# clone elsewhere works and the hook cannot silently check the wrong tree.
REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." 2>/dev/null && pwd)
STATE_DIR="${TMPDIR:-/tmp}/claude-first-release-version"

cd "$REPO" 2>/dev/null || { echo '{}'; exit 0; }
git rev-parse --git-dir >/dev/null 2>&1 || { echo '{}'; exit 0; }

payload=$(cat 2>/dev/null || true)
session=$(printf '%s' "$payload" | jq -r '.session_id // "nosession"' 2>/dev/null || echo nosession)

offenders=()

# A plugin is a folder holding a `manifest`. Found that way rather than from a
# list, so a plugin added next week is covered without editing this script.
while IFS= read -r manifest; do
  [ -n "$manifest" ] || continue
  folder=$(dirname "$manifest")

  # Committed at least once = not a first release, whatever its version says.
  if [ -n "$(git log --oneline -1 -- "$folder" 2>/dev/null)" ]; then
    continue
  fi

  # `version: 1.2.3`, the same line tests/version.test.js reads.
  version=$(sed -n 's/^version:[[:space:]]*\([^[:space:]]*\)[[:space:]]*$/\1/p' "$manifest" | head -1)
  [ -n "$version" ] || continue

  major=${version%%.*}
  case "$major" in
    ''|*[!0-9]*) continue ;;   # not a plain number; not this hook's business
  esac
  [ "$major" -ge 1 ] || continue

  offenders+=("$folder (version $version)")
done < <(git ls-files --cached --others --exclude-standard -- '*/manifest' 2>/dev/null)

if [ ${#offenders[@]} -eq 0 ]; then
  echo '{}'
  exit 0
fi

list=""
for o in "${offenders[@]}"; do
  list="$list  - $o"$'\n'
done

key=$(printf '%s' "$list" | md5sum 2>/dev/null | cut -c1-32)
sentinel="$STATE_DIR/$session-$key"

summary="First release at 1.0.0+: ${#offenders[@]} plugin(s) never committed claim a major version."

if [ -f "$sentinel" ]; then
  jq -n --arg m "$summary (already flagged)" '{systemMessage: $m}'
  exit 0
fi

mkdir -p "$STATE_DIR" 2>/dev/null && : > "$sentinel"

reason="Before finishing: these plugins have never been committed, so this is their
first release, and they declare a major version of 1 or higher.

$list
A new plugin starts at 0.0.1. The major digit is a claim to the user that the
thing works, and only running it in a real Stash can support that — a passing
test suite reproduces this repo's notes about Stash's markup and proves
self-consistency, nothing more. \"Feature-complete\" is a fact about the code and
answers a different question. This has been got wrong twice on exactly that
reasoning.

Set it to 0.0.1 in all three places (.yml, manifest and its date:, and
PLUGIN_VERSION), and say in the plugin's CLAUDE.md and README what would earn
the major digit. See \"A new plugin starts at 0.0.1\" in the repo-root CLAUDE.md.

If this really is a first release that has already been used in a live instance,
say so in one line and stop — it will not ask again for the same finding."

jq -n --arg r "$reason" --arg m "$summary" \
  '{decision: "block", reason: $r, systemMessage: $m}'
