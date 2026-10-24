#!/usr/bin/env bash
# play.sh — human-facing interactive wrapper around the dlb CLI (phase 3 slice).
#
# The game CLI itself never reads stdin (requirement R7: agents must never hang).
# That makes it great for agents and tedious for humans, so this wrapper supplies
# the interactive loop: show state, list actions, read one choice, repeat.
#
# usage:
#   ./scripts/play.sh                 start a new game at a random-ish seed
#   ./scripts/play.sh --seed 42       start at a specific seed (seeds are reproducible)
#   ./scripts/play.sh --auto          play itself, first legal action every turn (zero typing)
#   ./scripts/play.sh --character ironclad --difficulty 0
#
# Inside a game:
#   type an action id (p1, e1, c, s2, n1) and press Enter
#   ?    reprint the current state
#   h    reprint the legal actions
#   q    quit (progress is saved; resume with --resume)
#
# NOTE: the slice does not yet write an action log from `play` (replay logs come
# from `sim` and the test suite), so reproducibility comes from the seed.

set -uo pipefail

DLB="${DLB:-node bin/dlb}"
RUN_FILE="${RUN_FILE:-./play-run.json}"
SEED=""
AUTO=0
CHARACTER="ironclad"
DIFFICULTY=0
RESUME=0

# NOTE: $DLB is deliberately UNQUOTED everywhere — it is a command PREFIX (default
# "node bin/dlb"), so DLB="node --inspect bin/dlb" or a wrapper works as-is.
# The action log always lives next to the run file: foo.json -> foo.log.jsonl.
log_file_for() { printf '%s.log.jsonl\n' "${RUN_FILE%%.json}"; }
LOG_FILE="$(log_file_for)"

# --help prints this file's own header: every comment/blank line from after the
# shebang down to (not including) the `set` line, `# ` stripped. (Anchored on the
# header/code boundary, not on line numbers, so editing the header cannot silently
# truncate the help text.)
print_help() { sed -n '2,/^set -uo pipefail$/p' "$0" | sed '/^set -uo pipefail$/d; s/^# \{0,1\}//'; }

# Every value flag must actually carry a value: `--seed` with nothing after it used
# to leave the args unshifted and spin the parse loop forever.
need_value() {
  if [ $# -lt 2 ]; then
    echo "play.sh: $1 needs a value (try --help)" >&2
    exit 3
  fi
}

while [ $# -gt 0 ]; do
  case "$1" in
    --seed)       need_value "$@"; SEED="$2"; shift 2 ;;
    --auto)       AUTO=1; shift ;;
    --resume)     RESUME=1; shift ;;
    --character)  need_value "$@"; CHARACTER="$2"; shift 2 ;;
    --difficulty) need_value "$@"; DIFFICULTY="$2"; shift 2 ;;
    --run)        need_value "$@"; RUN_FILE="$2"; LOG_FILE="$(log_file_for)"; shift 2 ;;
    -h|--help)    print_help; exit 0 ;;
    *) echo "play.sh: unknown flag '$1' (try --help)" >&2; exit 3 ;;
  esac
done

# Is the engine actually here?
if ! $DLB --help >/dev/null 2>&1; then
  echo "play.sh: cannot run '$DLB --help' — run this from the project root." >&2
  exit 1
fi

draw_state()   { $DLB state   --run "$RUN_FILE" 2>/dev/null; }
draw_actions() { $DLB actions --run "$RUN_FILE" 2>/dev/null; }

is_over() { grep -qE 'GAME OVER|VICTORY|DEFEAT' <<<"$1"; }

start_new() {
  if [ -n "$SEED" ]; then
    $DLB new --seed "$SEED" --character "$CHARACTER" --difficulty "$DIFFICULTY" --run "$RUN_FILE"
  else
    # No seed given: pick one from the clock so runs vary, then print it so it can be replayed.
    SEED=$(( (RANDOM << 15 | RANDOM) % 100000000 ))
    echo "seed $SEED  (replay this run with: ./scripts/play.sh --seed $SEED)"
    $DLB new --seed "$SEED" --character "$CHARACTER" --difficulty "$DIFFICULTY" --run "$RUN_FILE"
  fi
}

if [ "$RESUME" = "1" ] && [ -f "$RUN_FILE" ]; then
  echo "resuming $RUN_FILE"
else
  start_new >/dev/null || { echo "play.sh: failed to start a run" >&2; exit 1; }
fi

echo
echo "=== dlb — 40-card vertical slice. type an action id, ? for state, h for help, q to quit ==="
echo

# One scratch file for the engine's stderr, cleaned up on any exit path.
ERR_FILE="$(mktemp "${TMPDIR:-/tmp}/dlb-play-err.XXXXXX")" || exit 1
trap 'rm -f "$ERR_FILE"' EXIT

turn=0
while : ; do
  state="$(draw_state)"
  if [ -z "$state" ]; then
    echo "play.sh: could not read state from $RUN_FILE" >&2
    exit 1
  fi
  printf '%s\n' "$state"

  if is_over "$state"; then
    echo
    if [ -s "$LOG_FILE" ]; then
      echo "=== run finished. replay it exactly with:  $DLB replay $LOG_FILE --assert"
    else
      # The slice does not write an action log on `play` yet, so do not promise one.
      echo "=== run finished ==="
      echo "    reproducible from its seed:  ./scripts/play.sh --seed ${SEED:-<seed printed above>}"
    fi
    break
  fi

  actions="$(draw_actions)"
  echo
  printf '%s\n' "$actions" | sed 's/^/   /'

  if [ "$AUTO" = "1" ]; then
    choice="$(printf '%s\n' "$actions" | head -1 | awk '{print $1}')"
    echo "   [auto] $choice"
  else
    printf '\n> '
    if ! IFS= read -r choice; then
      echo
      echo "(stdin closed — stopping. progress saved in $RUN_FILE)"
      break
    fi
  fi

  case "$choice" in
    "" ) continue ;;
    "?"|"state")  continue ;;
    "h"|"help")   echo "   action ids: p<n> play hand slot n | e1 end turn | c continue | s<n> pick reward | n<n> take map node | q quit"; continue ;;
    "q"|"quit")   echo "bye — progress saved in $RUN_FILE"; break ;;
  esac

  out="$($DLB play "$choice" --run "$RUN_FILE" 2>"$ERR_FILE")"
  rc=$?
  if [ -s "$ERR_FILE" ]; then
    printf '   ! %s\n' "$(cat "$ERR_FILE")"
  fi
  : >"$ERR_FILE"

  if [ "$rc" = "2" ]; then
    printf '   ! not a legal action right now — pick one of the ids above\n'
  fi

  turn=$((turn+1))
  echo
done

exit 0
