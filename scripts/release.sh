#!/usr/bin/env bash
#
# yomikake 統合リリーススクリプト（版数を単一ソースで一括管理）
#
#   scripts/release.sh <X.Y.Z> [オプション]
#
# 何をするか:
#   1. 前提チェック（main / tracked な未コミット変更なし / gh 認証）
#   2. 版数を 3 箇所に反映:
#        yomikake.html / yomikake_ios.html の APP_VERSION
#        sw.js の VERSION（'yomikake-shell-vX.Y.Z'）
#   3. 一致を検証 → 変化があれば "release: vX.Y.Z" でコミット
#   4. タグ vX.Y.Z を作成し main とタグを push
#   5. GitHub Release vX.Y.Z を作成（無ければ）
#
# オプション:
#   --notes-file FILE   リリースノート本文（省略時は --generate-notes）
#   --title TITLE       リリースタイトル（省略時は "vX.Y.Z"）
#   --yes               確認プロンプトを省略
#   --no-release        コミット・タグ・push まで（GitHub Release は作らない）
#
set -euo pipefail
die()  { echo "❌ $*" >&2; exit 1; }
info() { echo "▶ $*" >&2; }

[ $# -ge 1 ] || die "版数を指定してください（例: scripts/release.sh 2.10.1）"
RAW="$1"; shift; VER="${RAW#v}"
[[ "$VER" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "版数は X.Y.Z 形式で指定してください（受領: '$RAW'）"
TAG="v$VER"
NOTES_FILE=""; TITLE="$TAG"; ASSUME_YES=0; NO_RELEASE=0
while [ $# -gt 0 ]; do case "$1" in
  --notes-file) NOTES_FILE="${2:-}"; shift 2;;
  --title)      TITLE="${2:-}"; shift 2;;
  --yes|-y)     ASSUME_YES=1; shift;;
  --no-release) NO_RELEASE=1; shift;;
  *) die "不明なオプション: $1";;
esac; done
[ -z "$NOTES_FILE" ] || [ -f "$NOTES_FILE" ] || die "notes ファイルが見つかりません: $NOTES_FILE"

ROOT="$(git rev-parse --show-toplevel)"; cd "$ROOT"
for f in yomikake.html yomikake_ios.html sw.js; do [ -f "$f" ] || die "$f がありません（$ROOT）"; done

BR="$(git rev-parse --abbrev-ref HEAD)"
[ "$BR" = "main" ] || info "⚠ 現在のブランチは '$BR'（通常は main でリリース）"
if ! git diff --quiet || ! git diff --cached --quiet; then
  die "tracked な未コミット変更があります。コミットしてから実行してください"
fi
command -v gh >/dev/null || die "gh（GitHub CLI）が必要です"

echo "──────────────────────────────" >&2
echo " リリース $TAG（APP_VERSION / sw.js VERSION = $VER）" >&2
[ "$NO_RELEASE" != 1 ] && echo " ノート: ${NOTES_FILE:-（--generate-notes）}" >&2
echo "──────────────────────────────" >&2
if [ "$ASSUME_YES" != 1 ]; then
  read -r -p "続行しますか? [y/N] " a; [[ "$a" =~ ^[Yy]$ ]] || die "中止しました"
fi

# 版数を3箇所に反映（単一ソース化）
VER="$VER" python3 - <<'PY'
import os, re
ver = os.environ["VER"]
def sub(path, pat, repl):
    s = open(path, encoding="utf-8").read()
    new, n = re.subn(pat, repl, s, count=1)
    if n == 0:
        raise SystemExit("版数の書換対象が見つかりません: " + path)
    if new != s:
        open(path, "w", encoding="utf-8").write(new)
for h in ("yomikake.html", "yomikake_ios.html"):
    sub(h, r"(const APP_VERSION\s*=\s*')[^']*(')", lambda m: m.group(1) + ver + m.group(2))
sub("sw.js", r"(const VERSION\s*=\s*'yomikake-shell-v)[^']*(')", lambda m: m.group(1) + ver + m.group(2))
PY

# 一致検証
a1=$(grep -oP "const APP_VERSION\s*=\s*'\K[^']*" yomikake.html | head -1)
a2=$(grep -oP "const APP_VERSION\s*=\s*'\K[^']*" yomikake_ios.html | head -1)
sv=$(grep -oP "yomikake-shell-v\K[^']*" sw.js | head -1)
{ [ "$a1" = "$VER" ] && [ "$a2" = "$VER" ] && [ "$sv" = "$VER" ]; } \
  || die "版数不一致: yomikake.html=$a1 / ios=$a2 / sw.js=$sv（期待=$VER）"
info "版数を $VER に統一（yomikake.html / yomikake_ios.html / sw.js）"

if ! git diff --quiet; then
  git add yomikake.html yomikake_ios.html sw.js
  git commit -m "release: $TAG"
  info "release コミットを作成"
else
  info "版数は既に $VER（コミット不要）"
fi

if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
  info "タグ $TAG は既に存在（作成をスキップ）"
else
  git tag -a "$TAG" -m "$TITLE"; info "タグ $TAG を作成"
fi
info "main とタグを push"
git push origin "$BR"; git push origin "$TAG"

if [ "$NO_RELEASE" = 1 ]; then echo "✅ push 完了（Release 未作成）" >&2; exit 0; fi
if gh release view "$TAG" >/dev/null 2>&1; then
  info "Release $TAG は既存（作成をスキップ）"
else
  if [ -n "$NOTES_FILE" ]; then gh release create "$TAG" --title "$TITLE" --notes-file "$NOTES_FILE"
  else gh release create "$TAG" --title "$TITLE" --generate-notes; fi
fi
echo "✅ 完了: $TAG → $(gh release view "$TAG" --json url -q .url)" >&2
