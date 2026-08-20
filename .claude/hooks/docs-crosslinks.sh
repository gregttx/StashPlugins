#!/usr/bin/env bash
# Stop hook: documents that span folders, and drift between two plugins' docs.
#
# THIS HOOK IS THE LOOSE HALF, and it is meant to be. Its findings are guesses
# about documents no single directory owns: the suite index, the working plan,
# and - the reason it exists - one plugin's doc going quietly stale because a
# *different* plugin changed the mechanism they share.
#
# WHY IT IS SEPARATE FROM `docs-freshness.sh`. That hook compares two files in
# one folder, so a finding there is very nearly a fact. These rules reason across
# the repo and will be wrong sometimes. Mixed together, the wrong ones teach a
# reader to skim the right ones - which is how a check stops being read at all.
# Split by confidence, the strict hook stays worth answering and this one is
# allowed to be speculative, because muting it costs one line.
#
# WHAT RULE 3 IS ACTUALLY FOR. Five plugins share seven mechanisms by
# *duplication* - there is no module between them - and `tests/style.test.js`
# pins the overlapping CODE byte-identical. Nothing pins the PROSE. So a session
# that changes how `declares` works in one plugin, or corrects what one
# CLAUDE.md says about the lease, leaves four other documents describing the old
# behaviour with nothing failing. That is the gap: not a code drift the suite
# would catch, but a documentation drift no test can see, in the exact place
# this repo keeps its reasoning.
#
# HOW TO MUTE. One finding, or all of them:
#     echo 'tests/README.md' >> .claude/hooks/docs-crosslinks.mute
#     echo 'ALL'             >> .claude/hooks/docs-crosslinks.mute
# A line is matched as a plain substring against the finding text. The file is
# git-ignored: what one person finds noisy is not project policy.

. "$(dirname "${BASH_SOURCE[0]}")/common.sh"

STATE_DIR="${TMPDIR:-/tmp}/claude-docs-crosslinks"
MUTE="$(dirname "${BASH_SOURCE[0]}")/docs-crosslinks.mute"
PLAN=.plans/propagate-tags-and-performers.md
MAX=12                      # a wall of guesses is a wall nobody reads

[ -f "$MUTE" ] && grep -qxF 'ALL' "$MUTE" 2>/dev/null && { echo '{}'; exit 0; }

stale=()

# --- Rule 1: tests/README.md indexes the suites ------------------------------
# Medium confidence, and the reason it is over here rather than in the strict
# hook: a fix *inside* an existing suite needs no index change at all, so this
# fires on plenty of edits that are already complete.
if [ -f tests/README.md ] && ! in_list tests/README.md "$dirty"; then
  suites_dirty=$(printf '%s\n' "$dirty"      | grep -c '^tests/.*\.js$' || true)
  suites_head=$(printf '%s\n' "$head_files"  | grep -c '^tests/.*\.js$' || true)
  if [ "$suites_dirty" -gt 0 ]; then
    stale+=("tests/README.md — test suites have uncommitted changes")
  elif [ "$suites_head" -gt 0 ] && ! in_list tests/README.md "$head_files"; then
    stale+=("tests/README.md — left out of the last commit, which changed the suites")
  fi
fi

# --- Rule 2: the working plan against any plugin's source --------------------
# It was checked by mtime while git-ignored, and that rule was wrong twice: once
# against the last commit's timestamp, which `git commit --amend` moves forward
# past a document written correctly minutes earlier, and once against file
# mtimes, which a checkout or merge rewrites wholesale.
#
# It then went wrong a third way, which is why `is_plugin_source` exists: the
# pattern for "a plugin's source" was `<dir>/<file>.(js|yml)`, and `tools/`
# and `tests/` both contain paths of that shape. Adding `tools/probe.js`
# reported the plan as left behind by a change that touched no plugin at all.
if [ -f "$PLAN" ] && ! in_list "$PLAN" "$dirty"; then
  d_any=0 h_any=0
  while IFS= read -r f; do [ -n "$f" ] && is_plugin_source "$f" && d_any=1; done <<EOF
$dirty
EOF
  while IFS= read -r f; do [ -n "$f" ] && is_plugin_source "$f" && h_any=1; done <<EOF
$head_files
EOF
  if [ "$d_any" -eq 1 ]; then
    stale+=("$PLAN — plugin source has uncommitted changes")
  elif [ "$h_any" -eq 1 ] && ! in_list "$PLAN" "$head_files"; then
    stale+=("$PLAN — left out of the last commit, which changed plugin source")
  fi
fi

# --- Rule 3: one plugin's change against every other plugin's doc ------------
#
# The table is the repo's own list of shared mechanisms, one row per section of
# the root CLAUDE.md. A pattern has to be distinctive enough to mean the
# mechanism and not the English word - which is why it is `coop().order` and
# `insertOrdered` rather than `order`, and `coop().api` rather than `api`. A
# generic word here would match every document every time and the rule would be
# noise by the second run.
#
# `\bleases?\b` is bounded for a reason found by running this against the repo:
# bare `lease` is a substring of **release**, and one commit touching RELEASES.md
# reported all five plugin docs as drifting on the lease protocol. A pattern here
# is a claim about a mechanism, so it has to be a word and not a fragment.
#
# Both halves of what this is for fall out of one mechanism: a CODE change to a
# shared mechanism (the interaction moved, and four docs still describe the old
# one) and a DOC change to it (a correction was made in one place and the same
# sentence is wrong in four others). The origin is any changed plugin file; the
# candidates are every other plugin's docs plus the root CLAUDE.md, which is
# where the mechanisms are actually specified and so the likeliest to be stale.
shared_tokens() {
  cat <<'TOKENS'
the shared coop object|coopObject|StashPluginCoop|__GTTx__
the bulk-edit lease|\bleases?\b|acquire\(|respecters
the declares registry|declares
the published api|coop\(\)\.api|api\.prepare|\bprepare\(
button ordering|coop\(\)\.order|insertOrdered|_coopOwner
the shared MutationObserver|domBus
the shared debug switch|debugButtons
the button colour rule|PLUGIN_BTN_VARIANT|btn-warning|btn-info
the plural helper|plural\(
manual button placement|insertBeforeImportantAction|findActionByLabel|applyButtonSpacing|edit-buttons|details-edit
the shared dialog chrome|escapeButton|-modal\{|desc-toggle|tipbox
the name prefix|PLUGIN_SHORT_NAME|ownSettingGroup|ownTaskName|headingIsOurs
writing plugin settings|configurePlugin
TOKENS
}

# What a file's change actually touched. Untracked means the whole file is new.
changed_lines() {
  if in_list "$1" "$dirty"; then
    if git ls-files --error-unmatch "$1" >/dev/null 2>&1; then
      git diff -U0 -- "$1" 2>/dev/null; git diff --cached -U0 -- "$1" 2>/dev/null
    else
      cat "$1" 2>/dev/null
    fi
  else
    git show HEAD -U0 -- "$1" 2>/dev/null
  fi | grep -E '^[+-]' | grep -vE '^(\+\+\+|---)'
}

changed_files=$(printf '%s\n%s\n' "$dirty" "$head_files" | grep -vE '^$' | sort -u)

while IFS='|' read -r label pattern; do
  [ -n "$label" ] || continue

  # Which plugins' changes touched this mechanism.
  origins=''
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    # A plugin's own files, or the root CLAUDE.md where the mechanisms are
    # specified. `tools/probe.js` is why this is not a bare `*/*.js`: it names
    # nearly every shared mechanism, and as an origin it would have reported
    # drift in all five plugins for a file that changed no mechanism at all.
    case "$f" in
      CLAUDE.md) ;;
      */CLAUDE.md|*/README.md|*/manifest)
        d=${f%/*}; [ -f "$d/$d.js" ] || continue ;;
      *) is_plugin_source "$f" || continue ;;
    esac
    [ -f "$f" ] || continue
    changed_lines "$f" | grep -qE "$pattern" || continue
    origins="$origins${origins:+, }$f"
  done <<EOF
$changed_files
EOF
  [ -n "$origins" ] || continue

  # Every doc that describes the same mechanism and was not itself touched.
  while IFS= read -r doc; do
    [ -n "$doc" ] && [ -f "$doc" ] || continue
    printf '%s\n' "$changed_files" | grep -qxF "$doc" && continue
    case "$origins" in *"${doc%/*}/"*) [ "$doc" != CLAUDE.md ] && continue ;; esac
    grep -qE "$pattern" "$doc" 2>/dev/null || continue
    stale+=("$doc — $origins changed $label; this doc describes it and was not updated")
  done <<EOF
CLAUDE.md
$(plugin_dirs | sed 's|$|/CLAUDE.md|')
EOF
done <<EOF
$(shared_tokens)
EOF

# --- mute, cap, emit ---------------------------------------------------------
if [ -f "$MUTE" ] && [ ${#stale[@]} -gt 0 ]; then
  kept=()
  for f in "${stale[@]}"; do
    grep -qF -- "$f" "$MUTE" 2>/dev/null && continue
    muted=0
    while IFS= read -r m; do
      [ -n "$m" ] || continue
      case "$f" in *"$m"*) muted=1; break ;; esac
    done < "$MUTE"
    [ "$muted" -eq 0 ] && kept+=("$f")
  done
  stale=("${kept[@]+"${kept[@]}"}")
fi

[ ${#stale[@]} -eq 0 ] && { echo '{}'; exit 0; }

total=${#stale[@]}
[ "$total" -gt "$MAX" ] && stale=("${stale[@]:0:$MAX}")
list=$(printf '  - %s\n' "${stale[@]}")
[ "$total" -gt "$MAX" ] && list="$list  … and $((total - MAX)) more"

summary="Cross-plugin docs: $total possible drift(s). Low confidence."

emit "$STATE_DIR" "$summary" "Before finishing: these documents span folders, and something
elsewhere may have moved out from under them.

$list
These are guesses, not findings — the strict checks live in docs-freshness.sh.
Rule 3 in particular fires whenever one plugin's change touches a mechanism
another plugin's doc *describes*: five plugins duplicate seven mechanisms and
tests/style.test.js pins the code byte-identical, but nothing pins the prose.

Check whether the sentence is still true. If it is, say so in one line and stop —
it will not ask again for the same finding. If a whole rule is noise here:
  echo '<substring of the finding>' >> .claude/hooks/docs-crosslinks.mute" "$list"
