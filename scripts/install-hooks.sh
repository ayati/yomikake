#!/usr/bin/env bash
# git フック（版数ガード pre-push）を .git/hooks にインストールする。
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel)"
SRC="$ROOT/scripts/hooks/pre-push"
DST="$ROOT/.git/hooks/pre-push"
[ -f "$SRC" ] || { echo "❌ $SRC がありません" >&2; exit 1; }
chmod +x "$SRC"
ln -sf ../../scripts/hooks/pre-push "$DST"
echo "✅ pre-push フックをインストールしました: $DST -> scripts/hooks/pre-push"
