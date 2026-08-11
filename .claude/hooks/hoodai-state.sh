#!/usr/bin/env bash

set -euo pipefail

STATE_DIR="/tmp/hoodai"
STATE_FILE="${STATE_DIR}/claude-state.json"

STATE="${1:-idle}"

if [[ "$STATE" != "thinking" && "$STATE" != "idle" ]]; then
    echo "Usage: $0 {thinking|idle}" >&2
    exit 1
fi

mkdir -p "$STATE_DIR"

SESSION_ID="${CLAUDE_SESSION_ID:-unknown}"
TIMESTAMP="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

cat > "$STATE_FILE" <<EOF
{
  "state": "$STATE",
  "assistant": "Claude Code",
  "sessionId": "$SESSION_ID",
  "updatedAt": "$TIMESTAMP"
}
EOF
