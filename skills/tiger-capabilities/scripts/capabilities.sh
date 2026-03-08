#!/usr/bin/env bash
# tiger-capabilities CLI entry point
# Usage: capabilities.sh <command> [args...]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DATA_DIR="${TIGER_CLAW_HOME:-$HOME/.tiger-claw}/capabilities"
SKILL_DIR="$(dirname "$SCRIPT_DIR")"

mkdir -p "$DATA_DIR"

cmd="${1:-help}"
shift 2>/dev/null || true

case "$cmd" in
  list|ls)
    python3 "$SCRIPT_DIR/scanner.py" list "$@"
    ;;
  search)
    python3 "$SCRIPT_DIR/scanner.py" search "$@"
    ;;
  scan)
    python3 "$SCRIPT_DIR/scanner.py" scan "$@"
    ;;
  vet)
    python3 "$SCRIPT_DIR/vetter.py" "$@"
    ;;
  install)
    python3 "$SCRIPT_DIR/vetter.py" --install "$@"
    ;;
  flavor)
    subcmd="${1:-show}"
    shift 2>/dev/null || true
    case "$subcmd" in
      set)   python3 "$SCRIPT_DIR/scanner.py" flavor-set "$@" ;;
      list)  python3 "$SCRIPT_DIR/scanner.py" flavor-list ;;
      show)  python3 "$SCRIPT_DIR/scanner.py" flavor-show ;;
      *)     echo "Usage: capabilities flavor [show|set <name>|list]" ;;
    esac
    ;;
  trending)
    python3 "$SCRIPT_DIR/xfeed.py" trending "$@"
    ;;
  rss)
    python3 "$SCRIPT_DIR/rss_gen.py" "$@"
    ;;
  export)
    cat "$DATA_DIR/capabilities.json" 2>/dev/null || echo '{"installed": []}'
    ;;
  help|--help|-h)
    cat <<EOF
Tiger Claw Capabilities — Self-awareness layer for Tiger Claw bots

Commands:
  list                          List installed capabilities
  search <query>                Search ecosystem for skills
  scan                          Scan ClawdHub for new skills matching active Flavor
  vet <author/skill>            Vet a skill before install
  install <author/skill>        Vet and install a skill
  flavor [show|set|list]        Manage Flavor profiles
  trending                      Show trending skills from X Feed
  rss                           Generate RSS feed
  export                        Export capabilities manifest

Environment:
  TIGER_CLAW_HOME               Base directory (default: ~/.tiger-claw)
  GH_TOKEN                      GitHub token for API access
EOF
    ;;
  *)
    echo "Unknown command: $cmd (try 'capabilities.sh help')"
    exit 1
    ;;
esac
