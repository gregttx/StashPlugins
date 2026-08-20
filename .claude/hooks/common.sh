# Sourced by the two docs hooks. Not executable and not a hook itself.
#
# WHY THIS EXISTS: `docs-freshness.sh` and `docs-crosslinks.sh` have to agree on
# what "the change just made" means. Both need the working tree, both need the
# last commit, and both need the reflog guard that decides whether HEAD moving
# was a commit authored here or a reset that says nothing about anything. Two
# copies of that reasoning is two chances for one hook to quietly answer a
# different question from the other - and the whole point of splitting them was
# that a reader can trust the strict one.
#
# `first-release-version.sh` deliberately still carries its own copy. It is a
# working guard rail with a different job, and rewiring it was not asked for.
# If a fourth hook needs this, that is the moment to fold it in too.

set -u

REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." 2>/dev/null && pwd)
cd "$REPO" 2>/dev/null || { echo '{}'; exit 0; }
git rev-parse --git-dir >/dev/null 2>&1 || { echo '{}'; exit 0; }

payload=$(cat 2>/dev/null || true)
session=$(printf '%s' "$payload" | jq -r '.session_id // "nosession"' 2>/dev/null || echo nosession)

# Paths only, status codes stripped. Untracked files are in here too, which is
# what makes a brand-new document count as "being edited".
dirty=$(git status --porcelain 2>/dev/null | awk '{ $1=""; sub(/^ +/,""); print }')
head_files=$(git diff-tree --no-commit-id --name-only -r HEAD 2>/dev/null)

# HEAD moves for reasons that are not a commit. Rewinding a branch, switching to
# another one or rebasing all park HEAD on some older commit, and a rule reading
# `head_files` then reports that commit's docs as "left behind by the change just
# made" when the change was made days ago and was complete at the time. That is
# what it did after a `git reset` archived a branch.
#
# The reflog says which it was: its top entry is `commit: ...` when a commit was
# just created here, and `reset:` / `checkout:` / `rebase ...` when HEAD merely
# moved. Emptying `head_files` retires every HEAD-based rule at once while the
# working-tree rules still apply, since those describe the tree in front of us
# and stay true however HEAD got where it is.
#
# Cherry-pick, merge and rebase do introduce commits and are deliberately not
# treated as authoring: they replay work already reviewed where it was written.
# If the reflog is unavailable at all, the HEAD rules are left on rather than
# silently disabling half the check - a missing reflog is not the failure here.
reflog_top=$(git reflog --format='%gs' -1 2>/dev/null || true)
if [ -n "$reflog_top" ]; then
  case "$reflog_top" in
    commit:*|'commit (amend):'*|'commit (initial):'*|'commit (merge):'*) ;;
    *) head_files='' ;;
  esac
fi

in_list() { printf '%s\n' "$2" | grep -qxF "$1"; }

# A plugin is the one directory shape where the folder and the basename agree.
# Written as a backreference rather than `<dir>/<file>.js`, which is what the
# plan rule used and which matched `tools/probe.js` and would have matched
# `tests/run.js` - a false positive on a hook whose credibility is the only
# thing making anyone read it.
is_plugin_source() { printf '%s\n' "$1" | grep -q '^\([A-Za-z0-9]*\)/\1\.\(js\|yml\)$'; }
plugin_dirs() { for js in */*.js; do d=${js%/*}; [ "$d/$d.js" = "$js" ] && printf '%s\n' "$d"; done; }

# Blocks ONCE per distinct finding per session, keyed on the finding itself, so
# addressing it - or deciding it is already accurate - makes the next stop quiet.
# A hook that nags after it has been answered is a hook that gets switched off.
emit() {   # $1 state dir, $2 summary, $3 full reason text, $4 finding list (for the key)
  local state_dir=$1 summary=$2 reason=$3 list=$4 key sentinel
  key=$(printf '%s' "$list" | md5sum 2>/dev/null | cut -c1-32)
  sentinel="$state_dir/$session-$key"
  if [ -f "$sentinel" ]; then
    jq -n --arg m "$summary (already flagged)" '{systemMessage: $m}'
    exit 0
  fi
  mkdir -p "$state_dir" 2>/dev/null && : > "$sentinel"
  jq -n --arg r "$reason" --arg m "$summary" \
    '{decision: "block", reason: $r, systemMessage: $m}'
  exit 0
}
